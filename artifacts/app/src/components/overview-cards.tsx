/**
 * The overview cards (JPH-28 D2). They render on /reports/overview exactly as the old dashboard
 * did and inside close-checklist step 3; the figures come from one loader (services/dashboard).
 */
import Link from 'next/link';
import { checkLabel } from '@/copy/terms';
import { Card, KeyFigure, Money, StatusPill } from '@/components/ui';
import { GrantPaceStatus } from '@/components/grant-pace-status';
import { formatPeriod } from '@/domain/format';
import type { DashboardData } from '@/services/dashboard';

type Range = { from: Date; to: Date };

export function RestrictedBalancesCard({ data, label }: { data: DashboardData; label: string }) {
  return (
    <Card
      title="Restricted balances"
      action={<Link href={`/restricted?asOf=${label}`}>View funds →</Link>}
    >
      <KeyFigure
        label="Received minus spent"
        value={<Money cents={data.restrictedTotalCents} dollar data-testid="restricted-total" />}
        hint="A negative balance means spending is ahead of receipts."
      />
    </Card>
  );
}

export function FlaggedGrantsCard({ data, label }: { data: DashboardData; label: string }) {
  return (
    <Card title="Flagged grants" action={<Link href="/grants">View grants →</Link>}>
      <KeyFigure label="Grants requiring attention" value={data.flagged.length} />
      <ul className="mt-3 space-y-2">
        {data.flagged.map((g) => (
          <li key={g.id}>
            <Link href={`/grants/${g.id}/bva?asOf=${label}`}>{g.name}</Link>{' '}
            <GrantPaceStatus
              pace={g.pace}
              overBudgetLines={g.rows.filter((r) => r.overBudget).map((r) => r.name)}
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function UnmappedExpenseCard({ data }: { data: DashboardData }) {
  return (
    <Card
      title="Unmapped program expense"
      action={<Link href="/crosswalk/coverage">View coverage →</Link>}
    >
      <KeyFigure
        label="Program-service expense without a grant budget line"
        value={
          <Money cents={data.unmappedSummary.cents} dollar zero="zero" data-testid="unmapped-total" />
        }
      />
      <ul className="mt-3">
        {data.unmappedByProgram.map((row) => (
          <li key={row.code}>
            {row.name} <span className="muted text-sm">{row.code}</span>:{' '}
            <Money cents={row.cents} dollar />
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function NonGrantExpenseCard({ data }: { data: DashboardData }) {
  return (
    <Card title="Non-grant expense">
      <KeyFigure
        label="M&G and Fundraising · expected, not a warning"
        value={<Money cents={data.nonGrantCents} dollar data-testid="non-grant-total" />}
      />
      <ul className="mt-3">
        {data.nonGrantByProgram.map((row) => (
          <li key={row.code}>
            {row.name} <span className="muted text-sm">{row.code}</span>:{' '}
            <Money cents={row.cents} dollar />
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function HealthChecksCard({
  data,
  range,
  title = 'Health checks',
  emptyText = 'Health checks run with the next calculation.',
}: {
  data: DashboardData;
  range: Range;
  title?: string;
  emptyText?: string;
}) {
  const run = data.run;
  return (
    <Card
      title={title}
      action={<Link href={run ? `/runs/${run.id}` : '/activity'}>View calculation →</Link>}
    >
      {!run ? (
        <p className="muted">{emptyText}</p>
      ) : (
        <ul className="space-y-2" data-testid="health-checks">
          {data.checks.map((c) => (
            <li key={c.name} data-check={c.name} data-status={c.status ?? (c.ok ? 'pass' : 'fail')}>
              <StatusPill tone={c.status === 'warn' ? 'warn' : c.ok ? 'ok' : 'bad'}>
                {c.status ?? (c.ok ? 'pass' : 'fail')}
              </StatusPill>{' '}
              <Link href={c.href ?? `/runs/${run.id}`}>{checkLabel(c.name)}</Link>
              {typeof c.cents === 'number' ? (
                <>
                  {' '}
                  · <Money cents={c.cents} dollar zero="zero" data-testid={`check-${c.name}`} />{' '}
                  across {c.transactions ?? 0} transaction{c.transactions === 1 ? '' : 's'}
                  {c.name === 'unmapped_program_expense' ? (
                    <span className="muted"> · {formatPeriod(range.from, range.to)}</span>
                  ) : null}
                </>
              ) : c.detail ? (
                ` · ${c.detail}`
              ) : (
                ''
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
