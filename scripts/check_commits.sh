#!/usr/bin/env bash
# Rejects a commit subject that is not a Conventional Commit, so release-please can choose the version.
# Usage: scripts/check_commits.sh <before> <after>. Commits up to the rule's start are not checked.
set -euo pipefail

start=493ea56d16b3e49d3b293543229ab9323945ecd0
before=${1:-}
after=${2:-HEAD}
pattern='^(feat|fix|perf|refactor|docs|test|build|ci|chore|style|revert)(\([a-z0-9._-]+\))?!?: .+'

range=("$after" "^$start")
if [[ -n "$before" && ! "$before" =~ ^0+$ ]] && git cat-file -e "$before^{commit}" 2>/dev/null; then
  range+=("^$before")
fi

bad=0
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  subject=${line#* }
  if [[ ! "$subject" =~ $pattern ]]; then
    echo "not a Conventional Commit: ${line}" >&2
    bad=1
  fi
done < <(git log --no-merges --format='%h %s' "${range[@]}")

if ((bad)); then
  echo "Start each subject with a type, such as 'feat: ...' or 'fix(codex): ...'. See docs/operations/releases.md." >&2
  exit 1
fi
