---
name: Privacy denylist guard
description: How the no-private-data test behaves and what trips it.
---
- The denylist test scans every git-tracked file, including tests, comments and QUESTIONS.md, whole-word
  and case-insensitive. Example names in prose ("Mary" → "summary") trip it; use invented names.
- The denylist file itself lives in git-ignored fixtures/private; when absent the test skips, so a clean
  clone cannot prove anything — run it where the private fixtures exist before pushing.
- **Why:** it failed twice on my own explanatory text before the first push.
