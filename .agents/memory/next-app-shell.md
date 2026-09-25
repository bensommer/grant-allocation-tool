---
name: Next.js app-shell gotchas (artifacts/app)
description: Non-obvious behaviours hit while building the sidebar shell, header status indicator and server actions.
---
- The root layout gets the request path from `src/proxy.ts` (`x-pathname`/`x-search` headers);
  there is no other way for a server layout to know the URL. Keep the proxy matcher excluding
  `_next/` and static files only.
- A server action that redirects to the *current* URL does not re-render the root layout on the
  client unless it calls `revalidatePath('/', 'layout')` first (the header indicator kept showing
  "Recompute needed" after a successful recompute).
- Files marked `'use server'` may only export async functions; sync helpers (e.g. the
  `safeReturnPath` validator) live in `src/lib` and are imported.
- Server components must not import helpers from `'use client'` modules (every export becomes a
  client reference); shared pure logic like the active-route rule sits in a plain `.ts` module.
- e2e: server actions stream, so `waitForResponse` on the POST can resolve before the action
  finishes; poll the DB or the rendered state instead. Run timestamps show minute precision, so two
  runs in the same minute render identical text.
