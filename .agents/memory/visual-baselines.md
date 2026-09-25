---
name: Visual baselines
description: How the Playwright visual snapshots stay stable and how the e2e projects are ordered.
---
- `e2e/visual.spec.ts` baselines are captured against freshly restored demo data. The spec itself
  restores fixtures; the Playwright config runs it in its own `visual` project that the functional
  projects depend on, so a full local run is deterministic. Use `--project chromium --no-deps` to
  skip it while iterating; regenerate with `--project visual --update-snapshots`.
- Snapshot filenames embed the project name (`*-visual-linux.png`); renaming a project means
  `git mv` of every baseline.
- **Why:** a baseline captured after the narratives spec ran encoded a draft row and a stale-run
  banner and failed on clean data; parallel workers also let `status.spec` mark the run stale
  mid-capture.
- Any spec that imports extra transactions into the demo org (the QuickBooks report spec) must run in
  its own project *after* chromium/chromium-nojs and hard-clean its own rows: its lines otherwise
  land in the shared compute run and shift the fixture-cent totals other specs assert (seen as a
  custom-report grand total off by the pilot lines and BVA cells at 0).
- Header/subtitle timestamps are masked via `[data-volatile]`; anything new that prints a run time
  must carry that attribute or every baseline drifts.
