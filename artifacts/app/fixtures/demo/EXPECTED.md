# Harbor Kitchen Collective — golden expectations (Q1 2026)

Machine-readable copy: `expected.json` (all money in integer cents). `tests/golden.test.ts`
asserts every number below after `import:csv` + `seed:demo` + a compute run.

## Import counts

accounts 11 · classes 4 · locations 1 · parties 11 · transactions 20 · lines 38

## Expense by program × GL (2026-01-01 → 2026-03-31)

| GL                 | CT        | YM        | MG        | FR       | Total     |
| ------------------ | --------- | --------- | --------- | -------- | --------- |
| 6010 Salaries      | 24,600.00 | 16,800.00 | 7,200.00  | 2,400.00 | 51,000.00 |
| 6020 Payroll Taxes | 1,881.90  | 1,285.20  | 550.80    | 183.60   | 3,901.50  |
| 6110 Food          | 6,371.00  | 3,296.00  | –         | –        | 9,667.00  |
| 6210 Rent          | 4,500.00  | 1,800.00  | 2,700.00  | –        | 9,000.00  |
| 6220 Utilities     | 900.01    | 360.00    | 540.00    | –        | 1,800.01  |
| 6310 Contract      | 1,500.00  | –         | –         | –        | 1,500.00  |
| 6410 Office        | –         | –         | 250.10    | –        | 250.10    |
| **Total**          | 39,752.91 | 23,541.20 | 11,240.90 | 2,583.60 | 77,118.61 |

Rounding check: March utilities 600.01 split 50/20/30 → CT 300.01, YM 120.00, MG 180.00.

## Grant budget vs actual

| Grant / line | Budget     | Actual Q1 | Remaining | % used |
| ------------ | ---------- | --------- | --------- | ------ |
| G-MWSC PERS  | 72,000.00  | 26,481.90 | 45,518.10 | 36.8%  |
| G-MWSC SUPP  | 24,000.00  | 6,371.00  | 17,629.00 | 26.5%  |
| G-MWSC CONT  | 12,000.00  | 1,500.00  | 10,500.00 | 12.5%  |
| G-MWSC OCC   | 12,000.00  | 5,400.01  | 6,599.99  | 45.0%  |
| G-MWSC total | 120,000.00 | 39,752.91 | 80,247.09 | 33.1%  |
| G-HCF STAFF  | 36,000.00  | 18,085.20 | 17,914.80 | 50.2%  |
| G-HCF MEALS  | 14,000.00  | 3,296.00  | 10,704.00 | 23.5%  |
| G-HCF total  | 50,000.00  | 21,381.20 | 28,618.80 | 42.8%  |

## Restricted fund balances at 2026-03-31

G-MWSC 60,000.00 − 39,752.91 = 20,247.09 · G-HCF 25,000.00 − 21,381.20 = 3,618.80 · G-RFF excluded (unrestricted).

## Unmapped program expense

YM Rent 1,800.00 + YM Utilities 360.00 = 2,160.00 (allocated to a program, no grant budget line).
MG + FR expense 13,824.50 is non-grant functional expense, reported separately, not an error.
