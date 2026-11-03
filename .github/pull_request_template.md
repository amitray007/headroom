## What and why

<!-- What this changes and the problem it solves. Link the issue if there is one. -->

## Showcase

<!--
Show the change; the Showcase check fails without it. Drag files into this box to upload them.

Interface change (web or Mac): a screen recording, or a before and an after screenshot.
Use Demo Mode or synthetic data. Example:

| Before | After |
| --- | --- |
| <img alt="Before" src="..."> | <img alt="After" src="..."> |

Behaviour change (server, connectors, packages, HeadroomKit): show what was wrong and what
happens now. Use one or more of:
- a Mermaid diagram of the old and new flow (```mermaid fenced block)
- a table of before and after values: timings, memory, counts
- a request and response, or test output, in a fenced code block

Docs, tests and CI need no showcase.
-->

## How I verified it

- [ ] `mise run check` passes
- [ ] Tests added or updated for behaviour changes
- [ ] UI changes checked in the browser (Demo Mode is fine)

## Checklist

- [ ] No tokens, cookies, raw provider responses or personal data in code, fixtures, logs or screenshots
- [ ] Unknown metrics stay unknown, never zero
- [ ] New states are in `packages/core/src/enums.ts` and the data model
- [ ] Docs updated where behaviour changed
