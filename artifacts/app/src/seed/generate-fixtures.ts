import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Deterministic larger dataset generator (JPH-7). Same seed + months → byte-identical
 * CSVs. Reuses the demo master files (accounts/classes/locations/parties/company)
 * and synthesizes monthly transactions with the same shape as the golden data.
 * Golden assertions never apply to this output.
 */
export interface GenerateOptions {
  seed: number;
  months: number;
  demoDir: string;
  outDir: string;
  startYear?: number;
}

/** mulberry32 — small, fast, deterministic PRNG. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cents = (c: number) =>
  `${c < 0 ? '-' : ''}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, '0')}`;
const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export async function generateFixtures(
  opts: GenerateOptions,
): Promise<{ files: Record<string, string>; transactions: number; lines: number }> {
  const rand = rng(opts.seed);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
  const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const y0 = opts.startYear ?? 2026;

  await mkdir(opts.outDir, { recursive: true });
  for (const f of ['company.csv', 'accounts.csv', 'classes.csv', 'locations.csv', 'parties.csv']) {
    await copyFile(path.join(opts.demoDir, f), path.join(opts.outDir, f));
  }

  const header =
    'txn_external_id,txn_type,txn_date,doc_number,txn_memo,txn_party_external_id,payment_account_external_id,line_number,account_external_id,class_external_id,location_external_id,line_party_external_id,description,amount,posting_type';
  const rows: string[] = [];
  let txns = 0;
  const emit = (
    id: string,
    type: string,
    date: string,
    doc: string,
    memo: string,
    party: string,
    pay: string,
    lines: Array<[string, string, string, string, number, 'debit' | 'credit']>,
  ) => {
    txns++;
    lines.forEach(([acct, cls, lparty, desc, amt, side], i) => {
      rows.push(
        [
          id,
          type,
          date,
          doc,
          memo,
          party,
          pay,
          String(i + 1),
          acct,
          cls,
          'LOC-MAIN',
          lparty,
          desc,
          cents(amt),
          side,
        ].join(','),
      );
    });
  };

  for (let i = 0; i < opts.months; i++) {
    const y = y0 + Math.floor(i / 12);
    const m = (i % 12) + 1;
    const ym = `${y}-${pad(m)}`;
    const last = lastDay(y, m);
    // payroll with drift
    const chef = 500000 + between(-20000, 20000);
    const yc = 400000 + between(-15000, 15000);
    const ed = 800000 + between(-10000, 10000);
    const tax = (s: number) => Math.round(s * 0.0765);
    const total = chef + yc + ed + tax(chef) + tax(yc) + tax(ed);
    emit(
      `JE-PR-${ym}`,
      'JournalEntry',
      `${ym}-${pad(last)}`,
      `JE-PR-${ym}`,
      `Payroll ${ym}`,
      '',
      '',
      [
        ['A6010', 'C-CT', 'E-CHEF', 'Chef Instructor salary', chef, 'debit'],
        ['A6010', 'C-YM', 'E-YC', 'Youth Coordinator salary', yc, 'debit'],
        ['A6010', 'C-ADMIN', 'E-ED', 'Executive Director salary', ed, 'debit'],
        ['A6020', 'C-CT', 'E-CHEF', 'Payroll taxes', tax(chef), 'debit'],
        ['A6020', 'C-YM', 'E-YC', 'Payroll taxes', tax(yc), 'debit'],
        ['A6020', 'C-ADMIN', 'E-ED', 'Payroll taxes', tax(ed), 'debit'],
        ['A1000', '', '', 'Net payroll + taxes', total, 'credit'],
      ],
    );
    emit(`BILL-RENT-${ym}`, 'Bill', `${ym}-01`, `RENT-${pad(m)}`, `Rent ${ym}`, 'V-LAND', 'A2000', [
      ['A6210', 'C-ADMIN', '', 'Monthly rent', 300000, 'debit'],
    ]);
    emit(
      `BILL-UTIL-${ym}`,
      'Bill',
      `${ym}-15`,
      `EVR-${pad(m)}`,
      `Utilities ${ym}`,
      'V-UTIL',
      'A2000',
      [['A6220', 'C-ADMIN', '', 'Electric & gas', between(45000, 82000), 'debit']],
    );
    const foodCount = between(2, 5);
    for (let k = 0; k < foodCount; k++) {
      const cls = pick(['C-CT', 'C-YM'] as const);
      emit(
        `EXP-FOOD-${cls.slice(2)}-${ym}-${k + 1}`,
        'Expense',
        `${ym}-${pad(between(2, last))}`,
        `CFS-${pad(m)}${k + 1}`,
        'Food purchase',
        'V-FOOD',
        'A1000',
        [
          [
            'A6110',
            cls,
            '',
            cls === 'C-CT' ? 'Training kitchen food' : 'Youth meals food',
            between(40000, 250000),
            'debit',
          ],
        ],
      );
    }
    if (rand() < 0.5) {
      emit(
        `BILL-CHEF-${ym}`,
        'Bill',
        `${ym}-${pad(between(10, 25))}`,
        `ALV-${pad(m)}`,
        'Guest instructor',
        'V-CHEF',
        'A2000',
        [['A6310', 'C-CT', '', 'Guest chef instruction', between(50000, 200000), 'debit']],
      );
    }
    if (rand() < 0.6) {
      emit(
        `EXP-OFFICE-${ym}`,
        'Expense',
        `${ym}-${pad(between(2, 20))}`,
        `STP-${pad(m)}`,
        'Office supplies',
        'V-OFFICE',
        'A1000',
        [['A6410', 'C-ADMIN', '', 'Office supplies', between(5000, 40000), 'debit']],
      );
    }
    if (m % 3 === 1) {
      emit(
        `DEP-MWSC-${ym}`,
        'Deposit',
        `${ym}-10`,
        `DEP-${pad(m)}10`,
        'MWSC grant payment',
        'P-MWSC',
        'A1000',
        [['A4010', 'C-CT', 'P-MWSC', 'Culinary Workforce Grant installment', 3000000, 'credit']],
      );
      emit(
        `DEP-HCF-${ym}`,
        'Deposit',
        `${ym}-05`,
        `DEP-${pad(m)}05`,
        'HCF grant payment',
        'P-HCF',
        'A1000',
        [['A4010', 'C-YM', 'P-HCF', 'Youth Meals Grant installment', 1250000, 'credit']],
      );
    }
    if (rand() < 0.3) {
      emit(
        `DEP-GIFT-${ym}`,
        'Deposit',
        `${ym}-${pad(between(1, last))}`,
        `DEP-G${pad(m)}`,
        'Unrestricted gift',
        'P-RFF',
        'A1000',
        [['A4020', '', 'P-RFF', 'General operating gift', between(100000, 1500000), 'credit']],
      );
    }
  }
  const txt = header + '\n' + rows.join('\n') + '\n';
  await writeFile(path.join(opts.outDir, 'transactions.csv'), txt);

  const files: Record<string, string> = {};
  for (const f of [
    'company.csv',
    'accounts.csv',
    'classes.csv',
    'locations.csv',
    'parties.csv',
    'transactions.csv',
  ]) {
    files[f] = createHash('sha256')
      .update(await readFile(path.join(opts.outDir, f)))
      .digest('hex');
  }
  await writeFile(
    path.join(opts.outDir, 'MANIFEST.json'),
    JSON.stringify(
      {
        seed: opts.seed,
        months: opts.months,
        transactions: txns,
        lines: rows.length,
        sha256: files,
      },
      null,
      2,
    ) + '\n',
  );
  return { files, transactions: txns, lines: rows.length };
}
