import Link from 'next/link';
import { DataTable, Money, NumTd, StatusPill, Td, Th, TotalRow } from '@/components/ui';
import type { TieOut } from '@/services/grant-workspace';

/** Coded to grant = assigned + excluded (by reason) + needs review; effort on its own line. */
export function TieOutPanel({ id, tieOut: t }: { id: string; tieOut: TieOut }) {
  return (
    <div data-testid="tie-out" data-green={t.green ? '1' : '0'}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {t.green ? (
          <StatusPill tone="ok" icon="✓">
            Ties out — nothing waiting for review
          </StatusPill>
        ) : (
          <StatusPill tone="warn">
            {t.needsReviewCount} line{t.needsReviewCount === 1 ? '' : 's'} waiting for review
          </StatusPill>
        )}
        {t.stale && <StatusPill tone="muted">run is stale</StatusPill>}
        <Link href={`/grants/${id}/review`} className="text-sm">
          Open review queue →
        </Link>
      </div>
      <DataTable>
        <thead>
          <tr>
            <Th>Line</Th>
            <Th num>Amount ($)</Th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Td>Coded to the grant (member lines, current run)</Td>
            <NumTd cents={t.codedCents} data-testid="tie-coded" />
          </tr>
          <tr>
            <Td>Assigned to budget lines</Td>
            <NumTd cents={t.assignedCents} data-testid="tie-assigned" />
          </tr>
          {t.excluded.map((e) => (
            <tr key={e.reason}>
              <Td>
                Excluded — {e.reason}
                <span className="muted ml-2 text-xs">
                  {e.count} line{e.count === 1 ? '' : 's'}
                </span>
              </Td>
              <NumTd cents={e.cents} data-testid="tie-excluded" />
            </tr>
          ))}
          {t.excluded.length === 0 && (
            <tr>
              <Td>Excluded</Td>
              <NumTd cents={0} data-testid="tie-excluded" />
            </tr>
          )}
          <tr>
            <Td>
              Needs review
              {t.needsReviewCount > 0 && (
                <span className="muted ml-2 text-xs">
                  {t.needsReviewCount} line{t.needsReviewCount === 1 ? '' : 's'}
                  {t.pairedCount > 0 && `, ${t.pairedCount} in proposed reversal pairs`}
                </span>
              )}
            </Td>
            <NumTd cents={t.needsReviewCents} data-testid="tie-needs-review" />
          </tr>
          <TotalRow>
            <Th scope="row">Assigned + excluded + needs review</Th>
            <NumTd
              cents={t.assignedCents + t.excludedCents + t.needsReviewCents}
              dollar
              data-testid="tie-sum"
            />
          </TotalRow>
          <tr>
            <Td>Effort charges (not booked lines; JPH-22 schedules)</Td>
            <NumTd cents={t.effortCents} data-testid="tie-effort" />
          </tr>
          <TotalRow>
            <Th scope="row">Charged to budget lines (assigned + effort)</Th>
            <NumTd cents={t.chargedCents} dollar data-testid="tie-charged" />
          </TotalRow>
        </tbody>
      </DataTable>
      <p className="muted mt-2 text-xs">
        Coded <Money cents={t.codedCents} /> must equal the assigned + excluded + needs-review sum;
        the green check needs needs-review at 0.00 with every such line in a proposed reversal pair.
      </p>
    </div>
  );
}
