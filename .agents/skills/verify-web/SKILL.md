---
name: verify-web
description: See a Headroom web change on screen with synthetic data before calling it done. Use after changing `apps/web/src`, to capture before and after screenshots for a pull request, or to check a view at phone width, in dark mode or for page errors.
---

# Verify the web app

Tests prove the logic; this proves what the owner will see. Use the static demo build: it answers `/api/` inside the page with Demo Mode data, so it needs no server, no sign-in and no real account.

## Steps

1. Build: `mise run demo:build` writes `apps/web/dist-demo`.
2. Serve it with Vite on a free port, in the background, and record the PID:

   ```sh
   cd apps/web && mise exec -- bun x vite preview --outDir dist-demo --port 4399 --strictPort --host 127.0.0.1
   ```

   Serve with Vite only. Python's `http.server` drops some of the parallel module requests, and the page stays blank with no error.

3. Open it with the `browser` skill (agent-browser, one named session). Routes are hash routes: `#/`, `#/detailed`, `#/compare`, `#/timeline`, `#/wallet`, `#/analytics`.
4. Wait for content before any capture: `wait --fn "document.body.innerText.length > 200"`. A capture taken earlier is an empty page.
5. Check the changed view at 1280 x 800 and 390 x 844, in light and dark, with a short `wait 800` after each `set media` so transitions settle. Read `errors --json` and `console`; both must be empty of new entries.
6. Look at every screenshot yourself. A saved file is not a check.
7. Close the session and stop the server; confirm the port is free.

For before and after captures, run steps 1 to 6 once in a temporary worktree at `origin/main` and once on the branch, at the same widths, themes and route, then follow the [PR showcase skill](../pr-showcase/SKILL.md).

## Done when

- The changed view renders with demo data at both widths and both themes, and you looked at each capture.
- No new page error or console error.
- The browser session is closed and the server is stopped.

Use `mise exec -- bun run web:dev` against a dev server (`mise run dev`) only when the change depends on server behaviour that Demo Mode does not imitate. The Mac app is out of scope: the owner tests it.
