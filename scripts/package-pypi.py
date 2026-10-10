#!/usr/bin/env python3
"""Build the PyPI wheels (one per platform) from the release archives.

    python3 scripts/package-pypi.py --version 0.1.1 --assets <dir> --out <dir> --readme <file>

<dir> holds the release assets: the four headroom-<os>-<arch>.tar.gz archives and SHA256SUMS. The script checks
every archive against SHA256SUMS first. The --readme file comes from scripts/package-readme.ts, so the PyPI page shows
the repository README; the summary, keywords and links come from packaging/metadata.json. A platform whose archive is missing is skipped only with --allow-partial.
The wheel is written with zipfile; no build backend is needed. There is no sdist: the package is a prebuilt
binary, so a source build has nothing to compile. See packaging/README.md.
"""

import argparse
import base64
import hashlib
import io
import json
import os
import re
import sys
import tarfile
import zipfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACKAGE_DIR = os.path.join(REPO, "packaging", "pypi")
NAME = "headroomhq"
NOTICES = "THIRD_PARTY_NOTICES.md"
with open(os.path.join(REPO, "packaging", "metadata.json"), "rb") as _handle:
    METADATA = json.loads(_handle.read().decode("utf8"))
CLASSIFIERS = [
    "Development Status :: 4 - Beta",
    "Environment :: Web Environment",
    "Intended Audience :: Developers",
    "Operating System :: MacOS",
    "Operating System :: POSIX :: Linux",
    "Topic :: System :: Monitoring",
]
# Fixed timestamp so a rebuild gives identical wheels.
EPOCH = (2020, 1, 1, 0, 0, 0)

# Release asset platform -> wheel platform tags (the first tag names the file).
PLATFORMS = {
    "darwin-arm64": ["macosx_11_0_arm64"],
    "darwin-x64": ["macosx_10_15_x86_64"],
    "linux-x64": ["manylinux_2_17_x86_64", "manylinux2014_x86_64"],
    "linux-arm64": ["manylinux_2_17_aarch64", "manylinux2014_aarch64"],
}


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_sums(path: str) -> dict:
    sums = {}
    with open(path, encoding="utf8") as handle:
        for line in handle:
            parts = line.split()
            if len(parts) == 2:
                sums[parts[1].lstrip("*")] = parts[0].lower()
    return sums


def read_archive(path: str) -> tuple:
    """Return the bytes of `headroom`, `LICENSE` and the third-party notices from a release archive."""
    found = {}
    with tarfile.open(path, "r:gz") as archive:
        for member in archive.getmembers():
            name = member.name.removeprefix("./")
            if name in ("headroom", "LICENSE", NOTICES) and member.isfile():
                extracted = archive.extractfile(member)
                if extracted is None:
                    raise SystemExit(f"cannot read {name} from {path}")
                found[name] = extracted.read()
    for needed in ("headroom", "LICENSE", NOTICES):
        if needed not in found:
            raise SystemExit(f"{path} has no {needed} at the archive root")
    return found["headroom"], found["LICENSE"], found[NOTICES]


def record_hash(data: bytes) -> str:
    digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
    return f"sha256={digest}"


def build_wheel(
    version: str,
    tags: list,
    binary: bytes,
    license_text: bytes,
    notices: bytes,
    readme: str,
    out_dir: str,
) -> str:
    dist_info = f"{NAME}-{version}.dist-info"
    source = METADATA["repository"]
    with open(os.path.join(PACKAGE_DIR, NAME, "__init__.py"), "rb") as handle:
        init_py = handle.read()
    with open(os.path.join(PACKAGE_DIR, NAME, "__main__.py"), "rb") as handle:
        main_py = handle.read()

    metadata = (
        "Metadata-Version: 2.4\n"
        f"Name: {NAME}\n"
        f"Version: {version}\n"
        f"Summary: {METADATA['description']}\n"
        f"Keywords: {','.join(METADATA['keywords'])}\n"
        "License-Expression: MIT\n"
        "License-File: LICENSE\n"
        f"License-File: {NOTICES}\n"
        + "".join(f"Classifier: {classifier}\n" for classifier in CLASSIFIERS)
        + f"Project-URL: Homepage, {METADATA['homepage']}\n"
        f"Project-URL: Demo, {METADATA['demo']}\n"
        f"Project-URL: Documentation, {source}/blob/v{version}/docs/README.md\n"
        f"Project-URL: Source, {source}\n"
        f"Project-URL: Issues, {source}/issues\n"
        f"Project-URL: Changelog, {source}/blob/v{version}/CHANGELOG.md\n"
        f"Project-URL: Funding, {METADATA['funding']}\n"
        "Requires-Python: >=3.8\n"
        "Description-Content-Type: text/markdown\n"
        "\n"
        f"{readme}"
    ).encode("utf8")
    wheel_file = (
        "Wheel-Version: 1.0\n"
        "Generator: headroom package-pypi\n"
        "Root-Is-Purelib: false\n" + "".join(f"Tag: py3-none-{tag}\n" for tag in tags)
    ).encode("utf8")
    entry_points = (
        f"[console_scripts]\nheadroom = {NAME}:main\n{NAME} = {NAME}:main\n".encode("utf8")
    )

    # (path in wheel, bytes, unix mode)
    files = [
        (f"{NAME}/__init__.py", init_py, 0o644),
        (f"{NAME}/__main__.py", main_py, 0o644),
        (f"{NAME}/bin/headroom", binary, 0o755),
        (f"{dist_info}/METADATA", metadata, 0o644),
        (f"{dist_info}/WHEEL", wheel_file, 0o644),
        (f"{dist_info}/entry_points.txt", entry_points, 0o644),
        (f"{dist_info}/licenses/LICENSE", license_text, 0o644),
        (f"{dist_info}/licenses/{NOTICES}", notices, 0o644),
    ]
    record = io.StringIO()
    for path, data, _ in files:
        record.write(f"{path},{record_hash(data)},{len(data)}\n")
    record.write(f"{dist_info}/RECORD,,\n")
    files.append((f"{dist_info}/RECORD", record.getvalue().encode("utf8"), 0o644))

    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, f"{NAME}-{version}-py3-none-{'.'.join(tags)}.whl")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as wheel:
        for path, data, mode in files:
            info = zipfile.ZipInfo(path, EPOCH)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o100000 | mode) << 16
            wheel.writestr(info, data)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--version", required=True)
    parser.add_argument("--assets", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--readme", required=True, help="written by scripts/package-readme.ts")
    parser.add_argument("--allow-partial", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"\d+\.\d+\.\d+", args.version):
        sys.exit(f"version must be X.Y.Z, got {args.version}")

    sums_path = os.path.join(args.assets, "SHA256SUMS")
    if not os.path.isfile(sums_path):
        sys.exit(f"{sums_path} is missing; refusing to package unverified archives")
    sums = read_sums(sums_path)
    with open(args.readme, "rb") as handle:
        readme = handle.read().decode("utf8")

    built = 0
    for platform, tags in PLATFORMS.items():
        name = f"headroom-{platform}.tar.gz"
        path = os.path.join(args.assets, name)
        if not os.path.isfile(path):
            if args.allow_partial:
                continue
            sys.exit(f"{path} is missing")
        with open(path, "rb") as handle:
            actual = sha256_hex(handle.read())
        if sums.get(name) != actual:
            sys.exit(f"{name} does not match SHA256SUMS")
        binary, license_text, notices = read_archive(path)
        print(build_wheel(args.version, tags, binary, license_text, notices, readme, args.out))
        built += 1
    if built == 0:
        sys.exit("no archives found")


if __name__ == "__main__":
    main()
