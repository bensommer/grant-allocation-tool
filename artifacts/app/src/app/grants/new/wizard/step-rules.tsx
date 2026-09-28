import { Money } from '@/components/ui';
import { describeRule, type RuleLabels } from '@/domain/describe-rule';
import type { DraftLine } from '@/domain/grant-draft';
import type { FormState } from '@/lib/forms';
import type { ProposedRow } from '@/services/grant-draft';

/**
 * Step 5 — starting rules. One row per account (nonzero total, largest first) plus a row per
 * name with three or more transactions under it; each picks a working line or "Decide later".
 * Pre-selected only where the suggestion engine answered with confidence 'account'.
 */
export function StepRules({
  state,
  grantName,
  rows,
  lines,
}: {
  state: FormState;
  grantName: string;
  rows: ProposedRow[];
  lines: DraftLine[];
}) {
  const labels: RuleLabels = {
    programs: new Map(),
    accounts: new Map(rows.map((r) => [r.accountId, r.accountName])),
    classes: new Map(),
    locations: new Map(),
    parties: new Map(
      rows.flatMap((r) => (r.partyId && r.partyName ? [[r.partyId, r.partyName] as const] : [])),
    ),
  };
  if (rows.length === 0)
    return (
      <div className="banner banner-info" data-testid="rules-empty">
        No transactions carry the class or name chosen in step 2 yet, so there is nothing to
        propose. Finish now; rules can be added from the grant&apos;s Setup tab as transactions
        arrive.
      </div>
    );
  return (
    <div className="table-wrap overflow-x-auto">
      <table className="w-full text-sm" data-testid="rules-rows">
        <thead>
          <tr>
            <th scope="col">Account / name</th>
            <th scope="col" className="num">
              Transactions
            </th>
            <th scope="col" className="num">
              Total
            </th>
            <th scope="col">Send to</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const field = `rule_${r.key}`;
            const chosen =
              typeof state.values[field] === 'string'
                ? (state.values[field] as string)
                : (r.preselect ?? 'later');
            const target = lines.find((l) => l.code === chosen);
            const sentence = describeRule({
              scope: { grant: grantName },
              matchers: r.partyId
                ? { accountIds: [r.accountId], partyIds: [r.partyId] }
                : { accountIds: [r.accountId] },
              target: target ? { kind: 'line', name: target.name } : null,
              labels,
            }).sentence;
            return (
              <tr
                key={r.key}
                data-testid={r.partyId ? 'rule-name-row' : 'rule-account-row'}
                data-account={r.accountId}
                data-party={r.partyId ?? undefined}
                data-preselected={r.preselect ? 'true' : 'false'}
                data-cents={r.totalCents}
              >
                <td className={r.partyId ? 'pl-6' : ''}>
                  <span className="block">{r.partyId ? r.partyName : r.accountName}</span>
                  {r.partyId ? <span className="muted text-xs">under {r.accountName}</span> : null}
                  <span className="muted block text-xs" data-testid="rule-sentence">
                    {sentence}
                  </span>
                </td>
                <td className="num" data-count={r.count}>
                  {r.count.toLocaleString('en-US')}
                </td>
                <td className="num">
                  <Money cents={r.totalCents} zero="zero" />
                </td>
                <td>
                  <select
                    name={field}
                    defaultValue={chosen}
                    aria-label={`Send ${r.partyName ?? r.accountName} to`}
                  >
                    <option value="later">Decide later</option>
                    {lines.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
