---
name: Full e2e runs need a quiet workspace
description: Why the full Playwright suite must run alone, and how the dev server on 23863 is managed.
---
- While the full e2e suite runs in the background, do not edit source, run `prisma migrate`, run
  DB unit tests or restore the demo: Next hot-reloads and the shared dev DB flips mid-run and a
  dozen unrelated specs fail (reports/mobile/runs). Wait for `E2E_EXIT=` in the log first.
- `pkill -f "playwright test"` (or a killed shell) can also take down the ad-hoc dev server on
  port 23863 (`PORT=23863 pnpm dev` started from artifacts/app); check with curl and restart it,
  then warm the grant pages before launching e2e or the first spec times out compiling.
- Demo grant ids change on every `reset-demo.sh`; resolve them from `/grants` links, never hardcode.
- **Why:** one full run (≈6 min) was lost to concurrent review fixes on 2026-09-25.

## Memory: the 8 GB container cannot run the suite with 2 workers on a cold dev server
- `next dev` grows to 2.5–3 GB once every route is compiled; the editor's `tsserver.js` holds
  ~1 GB; each Playwright worker + Chromium is ~1 GB. With the default two workers the dev server
  was OOM-killed mid-run twice on 2026-09-26 (it "exits with code 0" and every later spec fails
  with ERR_CONNECTION_REFUSED / socket hang up, with no error in its log).
- Recipe that held: restore the demo DB, start the server, warm **every** route (loop over
  `src/app/**/page.tsx|route.ts` with placeholder ids — 404s still compile, incl. the pdf/xlsx
  routes that spike memory when compiled mid-run), kill `tsserver.js`, then
  `npm run e2e -- --workers=1` (≈10 min).
- Never `pkill -f next-server` / `pkill -f chromium` from ShellExec: the pattern matches the
  invoking shell's own command line and kills it. Use `pgrep -f "tsserver\.js" | xargs -r kill`
  style patterns or ShellKill on the task id.

## Crawl-list and dashboard pollution from test-created grants
- `e2e/routes.ts` crawls the **alphabetically first** grant and the dashboard specs assert the flagged-grant list, so a grant created by one Playwright project is visible to the other project running concurrently. Test grants must sort after the demo grants ("Z …"), start after the books-through date (a zero-spend grant that has started shows as "under pace"), and be removed through the app's own delete/archive flow.

## Sticky save bar vs Playwright clicks; hydration races
- Forms with the sticky `.save-bar` footer: Playwright's scroll-into-view can leave a control behind
  the footer ("<div class=save-bar> intercepts pointer events"). Fix in CSS with `scroll-margin-bottom`
  on the form's controls, not with `force: true` in the spec.
- Islands that change what a control does after hydration (a `<details>` that becomes a menu) need a
  `data-hydrated` marker the JS specs wait on; the same spec running in the `chromium-nojs` project
  must take the pre-hydration path deliberately (pass a js flag), or the first click lands on the
  static version and the second toggles it closed.
- Two rules with identical matchers at the same priority tie, so a preview of the second reports 0
  wins: in specs that save "the same rule twice" (JS vs no-JS), preview before the twin exists.

## Project testMatch regexes are substring matches

Anchor project matchers (`/(^|\/)pilot\.spec\.ts$/`), or a new spec whose filename contains an
existing spec's name silently runs inside that project too (with that project's settings, e.g.
JavaScript off). After adding a spec, confirm with `playwright test --list --project=<name> --no-deps`.
Specs are imported in Node, so they must not import modules that pull in `next/link` (e.g. nav.tsx).

## Same-URL server-action redirects race Playwright counts (JS on)
With JavaScript on, a form whose server action `redirect()`s back to the same URL (wizard
"add rows", recount) finishes *after* `click()` resolves and `toHaveURL` passes immediately, so a
`while (count < n) click()` loop re-clicks before the re-render and spins forever (and the
renderer grows past 1 GB). Wait on the DOM change (`expect(locator).toHaveCount(n)`) after each
click, never on the URL, and never loop on a raw `.count()`.

## Run the full suite against a production build, not `next dev`
The dev server's memory grows with every compiled route until the container kills it mid-suite,
even at one worker. `next build` + `next start` on a spare port (as a background task, with
`E2E_BASE_URL` pointing at it) is stable, several times faster, and renders the visual baselines
identically because the app is fully dynamic.
**Why:** two full runs died to OOM before this was tried; only the workers count had been tuned.
**How to apply:** before a full e2e run, stop the dev workflow, build, start prod, run, then
restart the dev workflow. Restore the demo fixture first (unit tests and any hit on an export
route leave state the dashboard snapshot can see).
