---
name: Report pivot keys are contracts
description: Why report dimension keys (e.g. "6010 Salaries & Wages") must not change for display purposes.
---
- Pivot keys (`number name` for GL accounts, codes for grants/lines/programs) are addressed directly by
  the golden DB tests and by saved report views. Display names/codes go in the fact's `labels` /
  `secondary` maps, never into the key.
- **Why:** a "presentation" tweak that reformatted the GL key broke the golden suite mid-overhaul.
- **How to apply:** any new report dimension gets a stable key plus label metadata; UI/export render labels.
