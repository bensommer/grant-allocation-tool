import { Money } from '@/components/ui';
import { budgetRows, parseBudget, type StepValues } from '@/domain/grant-draft';
import { formatMoney } from '@/domain/format';
import type { FormState } from '@/lib/forms';

/** Total of the categories entered so far against the award: "= award", "under by", "over by". */
export function TotalChip({
  totalCents,
  awardCents,
  label = 'Categories',
  testId = 'budget-total-chip',
}: {
  totalCents: number;
  awardCents: number;
  label?: string;
  testId?: string;
}) {
  const diff = totalCents - awardCents;
  const tone = diff === 0 ? 'pill-ok' : 'pill-warn';
  return (
    <p
      className={`pill ${tone} inline-flex flex-wrap items-center gap-1`}
      data-testid={testId}
      data-cents={totalCents}
      data-award-cents={awardCents}
      data-difference-cents={diff}
    >
      <span>
        {label} total <Money cents={totalCents} zero="zero" />
      </span>
      <span>
        {diff === 0
          ? '— equals the award'
          : diff < 0
            ? `— under the award by ${formatMoney(-diff)}`
            : `— over the award by ${formatMoney(diff)}`}
      </span>
    </p>
  );
}

function blankRows(values: StepValues): number {
  const n = Number(values['blankRows'] ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Step 3 — funder categories: paste two columns, or fill the rows. */
export function StepBudget({ state, awardCents }: { state: FormState; awardCents: number }) {
  const values = state.values;
  const filled = budgetRows(values).filter((r) => r.code || r.name || r.amount);
  const parsed = parseBudget(values);
  const totalCents = parsed.ok
    ? parsed.data.reduce((a, c) => a + c.budgetCents, 0)
    : filled.reduce((a, r) => {
        const n = Number(r.amount.replace(/[$,\s]/g, ''));
        return a + (Number.isFinite(n) ? Math.round(n * 100) : 0);
      }, 0);
  const blanks = Math.max(filled.length === 0 ? 4 : 1, blankRows(values));
  const rows = [
    ...filled,
    ...Array.from({ length: blanks }, () => ({ code: '', name: '', amount: '' })),
  ];
  const e = state.errors;
  return (
    <div className="grid gap-4">
      <details className="rounded border border-line bg-white p-3" open={filled.length === 0}>
        <summary className="cursor-pointer text-sm font-semibold">
          Paste two columns from the award letter or budget workbook
        </summary>
        <p className="muted mt-1 text-xs">
          One category per line: the name, then the amount (a tab, two spaces or a comma between
          them). A code in front is kept as the line code.
        </p>
        <textarea
          name="paste"
          rows={5}
          className="mt-2 w-full font-mono text-sm"
          placeholder={'Personnel\t80,000.00\nSupplies\t12,500.00'}
          defaultValue={typeof values['paste'] === 'string' ? values['paste'] : ''}
          data-testid="budget-paste"
        />
        <button
          type="submit"
          name="intent"
          value="paste"
          className="btn btn-secondary btn-sm mt-2"
          data-testid="budget-paste-apply"
        >
          Add pasted rows
        </button>
      </details>
      <div className="table-wrap overflow-x-auto">
        <table className="w-full text-sm" data-testid="budget-rows">
          <thead>
            <tr>
              <th scope="col" className="w-28">
                Code <span className="muted font-normal">(optional)</span>
              </th>
              <th scope="col">Funder category</th>
              <th scope="col" className="num w-40">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} data-testid="budget-row">
                <td>
                  <input
                    name="catCode"
                    defaultValue={r.code}
                    aria-label={`Code of category ${i + 1}`}
                    className="!w-full uppercase"
                  />
                  {e[`catCode_${i}`] ? <p className="field-error">{e[`catCode_${i}`]}</p> : null}
                </td>
                <td>
                  <input
                    name="catName"
                    defaultValue={r.name}
                    aria-label={`Name of category ${i + 1}`}
                    className="!w-full"
                  />
                  {e[`catName_${i}`] ? <p className="field-error">{e[`catName_${i}`]}</p> : null}
                </td>
                <td className="num">
                  <input
                    name="catAmount"
                    defaultValue={r.amount}
                    inputMode="decimal"
                    aria-label={`Amount of category ${i + 1}`}
                    className="!w-full text-right"
                  />
                  {e[`catAmount_${i}`] ? (
                    <p className="field-error">{e[`catAmount_${i}`]}</p>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <input type="hidden" name="blankRows" value={blanks} />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          name="intent"
          value="addrows"
          className="btn btn-secondary btn-sm"
          data-testid="budget-add-rows"
        >
          Add 3 rows
        </button>
        <TotalChip totalCents={totalCents} awardCents={awardCents} />
      </div>
    </div>
  );
}
