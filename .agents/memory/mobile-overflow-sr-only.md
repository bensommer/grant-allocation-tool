---
name: sr-only inside scrolling tables widens the page
description: Why the 390px mobile e2e check fails on pages whose tables have visually-hidden header text, and the fix.
---
Tailwind `sr-only` is `position: absolute`. Inside a `<th>`/`<td>` that is not positioned, its
containing block is the page, so it escapes the `overflow-x-auto` card and pushes
`document.documentElement.scrollWidth` past 390px (the page really scrolls horizontally) even
though no visible element overflows and hiding the card's overflow changes nothing.

**Why:** cost a long bisect on 2026-09-25; every "which element is wide?" probe pointed at the
(clipped) table, not the 1px span.
**How to apply:** any `sr-only` span inside a scroll container needs a positioned parent
(`<th className="relative">`), or use a visually-hidden technique that is not absolutely positioned.
Bisect trick that found it: hide `td/th` cells one at a time and watch `html.scrollWidth`.
