---
name: Pilot e2e state and parity report conventions
description: Why pilot e2e runs contaminate each other, and how the private parity report is kept private.
---
## Pilot seed is idempotent by name
`seed:pilot` reuses existing grants by name and skips reported periods whose snapshot exists, so
decisions, locks and drafts from an aborted run persist into the next one and shift line counts
(e.g. "9 lines" in the review queue reading fewer). The pilot spec's afterAll deletes the grants and any
`PeriodLock` created after the seed started (locks are org-wide and survive grant deletion).
**How to apply:** if pilot assertions fail on counts, clear Salah/Opioid grants + post-seed locks first.

## Parity report stays private
- Map + report live only under `fixtures/private/`; the CLI refuses tracked output paths and prints nothing
  from the workbook. Reasons are part of the map, validated before any read.
- Metric keys are the colon grammar documented at the top of `src/services/parity-metrics.ts`; add cells
  by adding map rows, not code.
- LibreOffice will happily return exceljs cached values; recalculation needs `OOXMLRecalcMode=0` in a
  throwaway profile (the AC4 test does this) — otherwise a "formulas" check proves nothing.
**Why:** the first parity pass read cached zeros for blank-cache formula cells and the recalc test
passed vacuously until the profile flag was set.
