#!/usr/bin/env python3
"""Check local Markdown structure and links without network or dependencies."""
from pathlib import Path
from urllib.parse import unquote, urlsplit
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
PROVIDERS = {"claude", "codex", "cursor", "copilot", "vercel-ai-gateway", "grok", "antigravity"}
STALE_STATES = {"connected", "connected_partial", "connected_with_limited_metrics", "pending_validation", "account_selection", "needs_reconnect", "waiting_for_browser", "waiting_for_code", "experimental", "experimental_member", "login_attempt"}
SECTIONS = ["Scope and recommendation", "Evidence status", "Metrics", "Connect workflow", "APIs and tools", "Available packages and limits", "Prior observations", "Cannot promise", "Implementation and validation checklist", "Sources"]
errors = []
files = sorted(ROOT.glob("*.md")) + sorted((ROOT / "docs").rglob("*.md"))

def prose(text):
    return re.sub(r"```.*?```", "", text, flags=re.S)

def anchors(text):
    result = set()
    counts = {}
    for heading in re.findall(r"^#{1,6} (.+)$", prose(text), re.M):
        slug = re.sub(r"[^\w\- ]", "", heading.lower()).replace(" ", "-")
        count = counts.get(slug, 0)
        counts[slug] = count + 1
        result.add(slug if count == 0 else f"{slug}-{count}")
    return result

for path in files:
    text = path.read_text()
    label = path.relative_to(ROOT)
    if path.name == "CLAUDE.md":
        if text.strip() != "@AGENTS.md" or not (ROOT / "AGENTS.md").is_file():
            errors.append(f"{label}: broken project instruction import")
        continue
    if len(re.findall(r"^# ", prose(text), re.M)) != 1:
        errors.append(f"{label}: expected exactly one H1")
    if text.count("```") % 2:
        errors.append(f"{label}: unclosed code fence")
    for line_number, line in enumerate(text.splitlines(), 1):
        if line.rstrip() != line:
            errors.append(f"{label}:{line_number}: trailing whitespace")
    for raw in re.findall(r"!?\[[^\]]*\]\(([^)]+)\)", prose(text)):
        target = raw.strip().strip("<>")
        parsed = urlsplit(target)
        if parsed.scheme or parsed.netloc:
            continue
        dest = (path.parent / unquote(parsed.path)).resolve() if parsed.path else path
        if not dest.is_relative_to(ROOT):
            errors.append(f"{label}: link escapes repository: {target}")
        elif not dest.exists():
            errors.append(f"{label}: missing target: {target}")
        elif parsed.fragment and dest.suffix == ".md":
            if unquote(parsed.fragment) not in anchors(dest.read_text()):
                errors.append(f"{label}: missing anchor: {target}")

for provider in sorted(PROVIDERS):
    path = ROOT / "docs/providers" / f"{provider}.md"
    if not path.is_file():
        errors.append(f"missing provider: {provider}")
        continue
    text = path.read_text()
    headings = re.findall(r"^## (.+)$", text, re.M)
    if headings != SECTIONS:
        errors.append(f"{provider}: provider sections must match the shared template")
    if not re.search(r"\b\d{4}-\d{2}-\d{2}\b", text) or "https://" not in text:
        errors.append(f"{provider}: missing review date or source URL")
    for stale in STALE_STATES:
        if f"`{stale}`" in text:
            errors.append(f"{provider}: uses non-canonical state `{stale}`; see docs/architecture/data-model.md")

index = (ROOT / "docs/README.md").read_text()
for path in (ROOT / "docs").rglob("*.md"):
    if path.name != "README.md" and str(path.relative_to(ROOT / "docs")) not in index:
        errors.append(f"docs index omits {path.relative_to(ROOT / 'docs')}")

if errors:
    print("\n".join(errors), file=sys.stderr)
    sys.exit(1)
print(f"Documentation check passed: {len(files)} Markdown files; {len(PROVIDERS)} provider dossiers.")
