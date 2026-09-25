/**
 * Metric keys the parity report can ask the app for. Keys are colon-separated:
 *
 *   <grant>:budget:<CODE>:budget|charged|remaining          budget line (or "total")
 *   <grant>:grid:<Activity name>:<CODE>:budget|charged|remaining|perOccurrence
 *   <grant>:grid:total:<CODE>:budget|charged|remaining
 *   <grant>:rollforward:beginning|received|direct|staff|overhead|ending
 *   <grant>:snapshot:<Period name>:direct|staff|overhead|received
 *   <grant>:drift:<Period name>:direct|overhead                 today's books inside the period
 *   <grant>:tieout:coded|assigned|excluded|needsReview|effort|charged
 *   <grant>:working:months                                    months left ×100 (5.3 → 530)
 *
 * `<grant>` is the seed key (e.g. "salah"); the caller maps keys to grant ids.
 */
import { prisma } from '@/lib/db';
import { budgetTree, type BudgetTree } from '@/services/grant-budget';
import {
  grantPeriodSnapshots,
  grantRollforward,
  periodDrift,
  type PeriodDriftRow,
  type PeriodSnapshotView,
} from '@/services/grant-periods';
import {
  activityGrid,
  tieOut,
  workingView,
  type ActivityGrid,
  type TieOut,
} from '@/services/grant-workspace';
import type { MetricResolver } from '@/reports/parity';

export class UnknownMetricError extends Error {}

export function createMetricResolver(
  orgId: string,
  grantIds: Record<string, string>,
  range: { from: Date; to: Date },
): MetricResolver {
  const trees = new Map<string, Promise<BudgetTree>>();
  const grids = new Map<string, Promise<ActivityGrid>>();
  const tieOuts = new Map<string, Promise<TieOut>>();
  const snaps = new Map<string, Promise<PeriodSnapshotView[]>>();
  const drifts = new Map<string, Promise<PeriodDriftRow[]>>();
  const rolls = new Map<string, ReturnType<typeof grantRollforward>>();
  const memo = <T>(m: Map<string, Promise<T>>, k: string, f: () => Promise<T>) => {
    let p = m.get(k);
    if (!p) {
      p = f();
      m.set(k, p);
    }
    return p;
  };

  return async (metric) => {
    const [key, kind, ...rest] = metric.split(':');
    const grantId = key ? grantIds[key] : undefined;
    if (!grantId) throw new UnknownMetricError(`${metric}: unknown grant "${key}"`);
    const tree = () => memo(trees, grantId, () => budgetTree(orgId, grantId));
    const pick = (obj: Record<string, number | null | undefined>, field: string | undefined) => {
      if (!field || !(field in obj))
        throw new UnknownMetricError(`${metric}: unknown field "${field}"`);
      return obj[field] ?? null;
    };
    switch (kind) {
      case 'budget': {
        const [code, field] = rest;
        const t = await tree();
        if (code === 'total')
          return pick(
            {
              budget: t.totals.budgetCents,
              charged: t.totals.chargedCents,
              remaining: t.totals.budgetCents - t.totals.chargedCents,
            },
            field,
          );
        const line = t.all.find((l) => l.code === code);
        if (!line) throw new UnknownMetricError(`${metric}: no budget line "${code}"`);
        return pick(
          {
            budget: line.currentCents,
            charged: line.chargedCents,
            remaining: line.currentCents - line.chargedCents,
          },
          field,
        );
      }
      case 'grid': {
        const [activity, code, field] = rest;
        const g = await memo(grids, grantId, async () => activityGrid(await tree()));
        const col = g.columns.findIndex((c) => c.code === code);
        if (col < 0) throw new UnknownMetricError(`${metric}: no grid column "${code}"`);
        if (activity === 'total') {
          const t = g.totals[col]!;
          return pick(
            { budget: t.budgetCents, charged: t.chargedCents, remaining: t.remainingCents },
            field,
          );
        }
        const row = g.rows.find((r) => r.name === activity);
        if (!row) throw new UnknownMetricError(`${metric}: no activity "${activity}"`);
        const c = row.cells[col]!;
        return pick(
          {
            budget: c.budgetCents,
            charged: c.chargedCents,
            remaining: c.remainingCents,
            perOccurrence: c.perOccurrenceCents,
          },
          field,
        );
      }
      case 'rollforward': {
        const r = await memo(rolls, grantId, () =>
          grantRollforward(orgId, grantId, range.from, range.to),
        );
        return pick(
          {
            beginning: r.beginningCents,
            received: r.receivedCents,
            direct: r.released.direct,
            staff: r.released.staff,
            overhead: r.released.overhead,
            ending: r.endingCents,
          },
          rest[0],
        );
      }
      case 'snapshot': {
        const [period, field] = rest;
        const all = await memo(snaps, grantId, () => grantPeriodSnapshots(orgId, grantId));
        const s = all.find((p) => p.name === period);
        if (!s) throw new UnknownMetricError(`${metric}: no closed period "${period}"`);
        return pick({ ...s.released, received: s.receivedCents }, field);
      }
      case 'drift': {
        const [period, cls] = rest;
        const all = await memo(drifts, grantId, () => periodDrift(orgId, grantId));
        const d = all.find((r) => r.period.name === period && r.cls === cls);
        if (!d) throw new UnknownMetricError(`${metric}: no drift row for "${period}" ${cls}`);
        return d.booksCents;
      }
      case 'tieout': {
        const t = await memo(tieOuts, grantId, () => tieOut(orgId, grantId));
        return pick(
          {
            coded: t.codedCents,
            assigned: t.assignedCents,
            excluded: t.excludedCents,
            needsReview: t.needsReviewCents,
            effort: t.effortCents,
            charged: t.chargedCents,
          },
          rest[0],
        );
      }
      case 'working': {
        const grant = await prisma.grant.findFirstOrThrow({
          where: { id: grantId },
          select: { endDate: true },
        });
        const v = workingView(await tree(), grant, range.to);
        return pick({ months: Math.round(v.months * 100) }, rest[0]);
      }
      default:
        throw new UnknownMetricError(`${metric}: unknown metric kind "${kind}"`);
    }
  };
}
