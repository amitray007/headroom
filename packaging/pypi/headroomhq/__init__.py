"""Headroom: self-hosted dashboard for AI account allowances, balances and usage.

This wheel carries the native `headroom` binary. `main()` replaces the Python process with it.
"""

import os
import stat
import sys

__all__ = ["main", "binary_path"]


def binary_path() -> str:
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "bin", "headroom")


def main() -> None:
    binary = binary_path()
    mode = os.stat(binary).st_mode
    if not mode & stat.S_IXUSR:
        os.chmod(binary, mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    try:
        os.execv(binary, [binary, *sys.argv[1:]])
    except OSError as error:
        sys.exit(f"headroom: cannot start {binary}: {error}")
