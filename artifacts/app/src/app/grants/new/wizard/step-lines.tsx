import { Money } from '@/components/ui';
import { centsToDecimalString } from '@/domain/money';
import { lineRows, type DraftCategory, type StepValues } from '@/domain/grant-draft';
import { formatMoney } from '@/domain/format';
import type { FormState } from '@/lib/forms';

function blankRows(values: StepValues): number {
  const n = Number(values['blankRows'] ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Step 4 — working lines (optional). The question first; "Yes" re-renders with a nested editor
 * prefilled with one working line per category; "No" makes the working lines the categories.
 */
export function StepLines({
  state,
  categories,
}: {
  state: FormState;
  categories: DraftCategory[];
}) {
  const values = state.values;
  const hasLines = values['hasLines'];
  const editorOpen = hasLines === 'yes';
  const posted = lineRows(values);
  const nonblank = posted.filter((r) => r.code || r.name || r.amount);
  const extra = Math.max(1, blankRows(values));
  const e = state.errors;
  return (
    <div className="grid gap-4">
      <fieldset className="grid gap-2">
        <legend className="text-sm font-semibold">
          Do you track people or sub-lines under those categories?
        </legend>
        {e['hasLines'] ? <p className="field-error">{e['hasLines']}</p> : null}
        <label className="flex items-center gap-2 text-sm font-normal normal-case text-ink">
          <input
            type="radio"
            name="hasLines"
            value="yes"
            defaultChecked={hasLines === 'yes'}
            data-testid="lines-yes"
          />
          <span>
            <strong>Yes</strong> — I want working lines (people, sub-lines) that roll up into each
            category
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm font-normal normal-case text-ink">
          <input
            type="radio"
            name="hasLines"
            value="no"
            defaultChecked={hasLines === 'no'}
            data-testid="lines-no"
          />
          <span>
            <strong>No</strong> — track each category as one line
          </span>
        </label>
        {!editorOpen ? (
          <p className="muted text-xs">
            Choose Yes and Continue to open the editor, prefilled with one working line per
            category.
          </p>
        ) : null}
      </fieldset>
      {editorOpen ? (
        <div className="grid gap-4" data-testid="lines-editor">
          {categories.map((c, ci) => {
            const own = nonblank.filter((r) => r.category === ci);
            const rows =
              own.length > 0
                ? own
                : [
                    {
                      category: ci,
                      code: '',
                      name: c.name,
                      amount: centsToDecimalString(c.budgetCents),
                    },
                  ];
            const total = rows.reduce((a, r) => {
              const n = Number(r.amount.replace(/[$,\s]/g, ''));
              return a + (Number.isFinite(n) ? Math.round(n * 100) : 0);
            }, 0);
            const diff = total - c.budgetCents;
            const all = [
              ...rows,
              ...Array.from({ length: extra }, () => ({
                category: ci,
                code: '',
                name: '',
                amount: '',
              })),
            ];
            return (
              <section
                key={c.code}
                className="rounded border border-line bg-white p-3"
                data-testid="lines-category"
                data-code={c.code}
              >
                <h3 className="flex flex-wrap items-baseline justify-between gap-2 text-sm font-semibold">
                  <span>{c.name}</span>
                  <span className="muted font-normal">
                    Category <Money cents={c.budgetCents} zero="zero" />
                  </span>
                </h3>
                <div className="table-wrap overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th scope="col" className="w-28">
                          Code <span className="muted font-normal">(optional)</span>
                        </th>
                        <th scope="col">Working line</th>
                        <th scope="col" className="num w-40">
                          Amount
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {all.map((r, i) => {
                        const idx = nonblank.indexOf(r as (typeof nonblank)[number]);
                        return (
                          <tr key={i} data-testid="line-row">
                            <td>
                              <input type="hidden" name="lineCat" value={ci} />
                              <input
                                name="lineCode"
                                defaultValue={r.code}
                                aria-label={`Code of ${c.name} line ${i + 1}`}
                                className="!w-full uppercase"
                              />
                              {idx >= 0 && e[`lineCode_${idx}`] ? (
                                <p className="field-error">{e[`lineCode_${idx}`]}</p>
                              ) : null}
                            </td>
                            <td>
                              <input
                                name="lineName"
                                defaultValue={r.name}
                                aria-label={`Name of ${c.name} line ${i + 1}`}
                                className="!w-full"
                              />
                              {idx >= 0 && e[`lineName_${idx}`] ? (
                                <p className="field-error">{e[`lineName_${idx}`]}</p>
                              ) : null}
                            </td>
                            <td className="num">
                              <input
                                name="lineAmount"
                                defaultValue={r.amount}
                                inputMode="decimal"
                                aria-label={`Amount of ${c.name} line ${i + 1}`}
                                className="!w-full text-right"
                              />
                              {idx >= 0 && e[`lineAmount_${idx}`] ? (
                                <p className="field-error">{e[`lineAmount_${idx}`]}</p>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p
                  className={`pill ${diff === 0 ? 'pill-ok' : 'pill-warn'} mt-2 inline-block`}
                  data-testid="lines-total-chip"
                  data-cents={total}
                  data-difference-cents={diff}
                >
                  Lines total {formatMoney(total, { zero: 'zero' })}
                  {diff === 0
                    ? ' — equals the category'
                    : diff < 0
                      ? ` — under the category by ${formatMoney(-diff)}`
                      : ` — over the category by ${formatMoney(diff)}`}
                </p>
              </section>
            );
          })}
          <input type="hidden" name="blankRows" value={extra} />
          <div>
            <button
              type="submit"
              name="intent"
              value="addrows"
              className="btn btn-secondary btn-sm"
              data-testid="lines-add-rows"
            >
              Add a row under each category
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
