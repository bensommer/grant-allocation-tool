/**
 * Gathers the facts the month-end close checklist needs (JPH-28 D2) and hands them to the pure
 * `closeStatus` in src/domain/close-status.ts. Everything here is read-only.
 */
import { checkLabel } from '@/copy/terms';
import { closeStatus, type CloseInput, type CloseStatus } from '@/domain/close-status';
import { prisma } from '@/lib/db';
import type { CurrentPeriod } from '@/lib/period';
import { dashboardData, type DashboardData } from '@/services/dashboard';
import { effortSummary } from '@/services/effort';
import { orgReviewQueue } from '@/services/review-queue';

export const ROLLFORWARD_EXPORT_KIND = 'rollforward_xlsx';

export interface CloseView {
  status: CloseStatus;
  input: CloseInput;
  dashboard: DashboardData;
  /** The most recent failed calculation newer than the current one, if any (AC2 blocker). */
  failedRun: { id: string; finishedAt: Date | null; cause: string | null } | null;
}

export async function loadCloseStatus(
  orgId: string,
  period: CurrentPeriod,
  now = new Date(),
): Promise<CloseView> {
  const asOf = period.date;
  const [dashboard, review, scheduleGrants, drafts, exportRow, periodLock, currentRun] =
    await Promise.all([
      dashboardData(orgId, period),
      orgReviewQueue(orgId),
      prisma.effortSchedule.findMany({
        where: { orgId, active: true, grant: { status: { not: 'archived' } } },
        select: { grantId: true },
        distinct: ['grantId'],
      }),
      prisma.correctingEntryDraft.findMany({
        where: { orgId, status: 'drafted' },
        select: {
          code: true,
          grantId: true,
          grant: { select: { name: true } },
          lines: { select: { debitCents: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.export.findFirst({
        where: {
          orgId,
          kind: ROLLFORWARD_EXPORT_KIND,
          periodFrom: { lte: asOf },
          periodTo: { gte: asOf },
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      prisma.periodLock.findFirst({
        where: { orgId, periodFrom: { lte: asOf }, periodTo: { gte: asOf } },
        orderBy: { lockedAt: 'desc' },
        select: { id: true, name: true },
      }),
      prisma.computeRun.findFirst({
        where: { orgId, isCurrent: true },
        select: { startedAt: true },
      }),
    ]);
  const effortViews = await Promise.all(
    scheduleGrants.map(async ({ grantId }) => {
      const summary = await effortSummary(orgId, grantId, asOf);
      const grant = await prisma.grant.findUniqueOrThrow({
        where: { id: grantId },
        select: { name: true },
      });
      return summary.schedules
        .filter((s) => s.active)
        .map((s) => ({
          grantId,
          grantName: grant.name,
          personLabel: s.personLabel,
          varianceCents: s.varianceCents,
          carried: s.carriedVarianceCents !== null && s.carriedVarianceCents === s.varianceCents,
        }));
    }),
  );
  const failedRun = await prisma.computeRun.findFirst({
    where: {
      orgId,
      status: 'failed',
      ...(currentRun ? { startedAt: { gt: currentRun.startedAt } } : {}),
    },
    orderBy: { startedAt: 'desc' },
    select: { id: true, finishedAt: true, cause: true },
  });
  const input: CloseInput = {
    asOf,
    now,
    lastImport: dashboard.lastImport
      ? {
          at: dashboard.lastImport.finishedAt ?? dashboard.lastImport.startedAt,
          status: dashboard.lastImport.status,
        }
      : null,
    review: {
      count: review.grants.filter((g) => g.totalCents !== 0).reduce((n, g) => n + g.count, 0),
      totalCents: review.totalCents,
      pairs: review.grants.filter((g) => g.totalCents === 0).reduce((n, g) => n + g.count, 0),
    },
    flaggedGrants: dashboard.flagged.map((g) => ({ id: g.id, name: g.name })),
    // Every check that does not pass: a stored `warn`, a stored `fail`, or an older row with
    // only `ok: false`. `stats` is bookkeeping, not a check.
    healthWarnings: dashboard.checks
      .filter((c) => c.name !== 'stats' && (c.status === 'warn' || c.status === 'fail' || !c.ok))
      .map((c) => ({
        name: c.name,
        label: checkLabel(c.name),
        status: c.status === 'fail' || !c.ok ? ('fail' as const) : ('warn' as const),
      })),
    effort: effortViews.flat(),
    drafts: drafts.map((d) => ({
      grantId: d.grantId,
      grantName: d.grant.name,
      code: d.code,
      amountCents: d.lines.reduce((n, l) => n + l.debitCents, 0),
    })),
    exportedAt: exportRow?.createdAt ?? null,
    periodLock,
    lastCalculationFailed: failedRun !== null,
  };
  return { status: closeStatus(input), input, dashboard, failedRun };
}
