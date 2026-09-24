---
name: Visual baselines
description: How the Playwright visual snapshots stay stable.
---
- `e2e/visual.spec.ts` baselines are captured against freshly restored demo data. Other specs
  create grants/imports/narratives, so run visual first (CI does) or restore demo data before
  regenerating with `--update-snapshots`.
- **Why:** a baseline captured after the narratives spec ran encoded a draft row and a stale-run
  banner and failed on clean data.
