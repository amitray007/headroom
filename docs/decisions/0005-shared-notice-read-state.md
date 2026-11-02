# ADR 0005: Shared notice read state

Status: accepted on 2026-11-01 by the owner. Supersedes the read-state part of [ADR 0004](0004-mac-app.md), which kept read state on the Mac and in the browser.

## Context

The dashboard kept its read notice ids in browser storage. The Mac app kept its own. Reading a notice in one place left it unread in the other, and in every other browser.

## Decision

- The server keeps one set of read notice ids in `notice_reads`. A mark older than 90 days is deleted on a later write, because a notice id changes with each period.
- The dashboard reads and writes the set with `GET` and `PUT /api/notices/read` under a session.
- The feed adds `read` to each notice. The Mac app writes with `PUT /api/app/v1/notices/read`.
- Any valid app token may write read marks, including a read-only one. The write changes only Headroom's own state and never a provider account, so it needs no new scope.
- Notice ids are the same in the dashboard and the feed. The time zone and the time style do not enter an id.
- A browser that holds read ids in local storage sends them to the server once and then clears them.
- Demo Mode keeps its read state in memory and never calls the server.

Banner history and the per-kind switches stay on the Mac, as ADR 0004 says.

## Consequences

- A notice read anywhere is read everywhere. Marking is a last-write-wins set, so two devices that mark the same id agree.
- The Mac app must send its marks and read the flag from the feed. Its own read store goes away.
- A token can now write one more thing. [D44](README.md) still holds: Refresh Every needs the `refresh` scope.
