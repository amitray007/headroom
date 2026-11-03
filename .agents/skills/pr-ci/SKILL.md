---
name: pr-ci
description: Keep Headroom pull requests mergeable and their CI results true. Use before saying a pull request is green or ready, when a check fails or never starts, when a branch or stacked pull request falls behind main, or when a fork pull request waits for workflow approval.
---

# PR CI

"Green" means every required check ran on the pull request's **head commit** and passed. A green rollup can hide a missing run: on 2026-11-02 nine stacked pull requests showed only CodeQL after a fast multi-branch push, and CI had never run on them.

## Check that CI ran

The main ruleset requires `commits`, `check`, `binary-macos`, `site` and `image`. `showcase` runs on every pull request and must pass as well. A pull request that touches `apps/macos` also runs `macOS / ci`; it is not required, because its path filter would block other pull requests, but it must pass too.

```sh
sha=$(gh pr view <number> --json headRefOid -q .headRefOid)
gh api "repos/amitray007/headroom/commits/$sha/check-runs" -q '.check_runs[] | "\(.name) \(.conclusion)"'
```

CodeQL alone is not CI. When a required check is missing on the head commit, close and reopen the pull request (`gh pr close <n> && gh pr reopen <n>`); the `reopened` event starts every workflow. A run that ends in `startup_failure` also needs a close and reopen; a rerun repeats the failure.

## Bring a branch up to date

CI tests a pull request merged into its base, and the base keeps moving. When main changes a shared builder or the app feed, also rebuild the generated Mac files:

1. Merge `origin/main` into the branch. A shared or stacked branch is updated by merges only, never rebased.
2. Run `mise run mac:fixtures` and `mise run mac:contract` when `packages/view-model`, `apps/server/src/routes/app.ts` or `scripts/app-contract.ts` changed on either side. Commit what they change.
3. Run `mise run check && git commit && git push`, chained so a failure stops the push.

## Stacked pull requests

A stack is managed with `gh stack` (`gh stack view`). Update it bottom-up: fix the lowest pull request that fails, then merge each branch into the one above it, running step 2 and step 3 at every layer. Merge the whole stack only with the owner's approval, in one atomic step: `gh stack merge <stack> --merge --yes`. The repository keeps `delete_branch_on_merge` off, so a merge one pull request at a time leaves the next one targeting a stale branch.

## Fork pull requests

Workflow runs from a first-time contributor wait as `action_required`. Before approving, list what the pull request changes outside its code:

```sh
git fetch origin pull/<n>/head:refs/tmp/pr<n>
git diff --stat origin/main...refs/tmp/pr<n> -- .github scripts package.json bun.lock mise.toml
```

With an empty result, approve: `gh api -X POST repos/amitray007/headroom/actions/runs/<run-id>/approve`. With any change there, ask the owner first. A new push from the contributor needs a new approval.

## Workflows that push to main

The release bots push to main with the `RELEASE_DEPLOY_KEY` checkout key and `[skip ci]` in the bot commit message. A new workflow that pushes to main uses the same pattern ([Pushes to main](../../../docs/operations/releases.md#pushes-to-main)).

## Done when

- Every required check, and `macOS / ci` when it applies, shows `success` on each pull request's head commit.
- `gh pr view <n> --json mergeStateStatus` is `CLEAN`, or `UNSTABLE` only from a check that is not required and that you reported.
