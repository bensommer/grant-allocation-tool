---
name: Privacy denylist guard
description: How the no-private-data test behaves and what trips it.
---
- The denylist test scans every git-tracked file, including tests, comments and QUESTIONS.md, whole-word
  and case-insensitive. Do not quote real first names as examples in prose or memory notes, even to
  explain the guard — that is exactly what tripped it. Use clearly invented names.
- The denylist file itself lives in git-ignored fixtures/private; when absent the test skips, so a clean
  clone cannot prove anything — run it where the private fixtures exist before pushing.
- **Why:** explanatory prose that names a real person trips it just like code does.
- "Not tracked by git" is not "safe to write private output to": a path that does not exist yet and
  matches no ignore rule would be offered for `git add`. Private-output guards must require the path
  to be *ignored* (`git check-ignore`), not merely absent from `git ls-files`.
