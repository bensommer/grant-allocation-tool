import { NAV_GROUPS } from '@/components/nav';
import { TERMS } from '@/copy/terms';
import { isActiveRoute } from '@/components/active-route';
import { formatDate } from '@/domain/format';
import { prisma } from '@/lib/db';

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * The full breadcrumb trail for a pathname (JPH-25 A4), rendered once by the root layout.
 * The App Router gives a layout no props from the page it wraps, so the trail is derived
 * here from the pathname: the sidebar group and item first, then the route's own tail
 * (entity names are looked up by id). Every page therefore gets the same trail rules and
 * no page renders its own.
 */
export async function breadcrumbsFor(orgId: string, pathname: string): Promise<Crumb[]> {
  const segments = pathname.split('/').filter(Boolean);
  const base = navBase(pathname);
  const tail = await routeTail(orgId, segments);
  return dedupe([...base, ...tail]);
}

function navBase(pathname: string): Crumb[] {
  for (const group of NAV_GROUPS)
    for (const item of group.items)
      if (isActiveRoute(pathname, item.href, item.matches)) {
        if (item.label === group.label) return [{ label: group.label, href: item.href }];
        return [{ label: group.label }, { label: item.label, href: item.href }];
      }
  return [];
}

/** Drop a crumb that repeats the label of the one before it (group === item, or item === page). */
function dedupe(crumbs: Crumb[]): Crumb[] {
  return crumbs.filter((c, i) => i === 0 || c.label !== crumbs[i - 1]!.label);
}

const GRANT_TABS: Record<string, string> = {
  bva: 'Budget vs. Actuals',
  todo: 'To do',
  budget: 'Budget lines',
  edit: 'Edit grant',
  review: 'Review',
  effort: 'Effort',
  entries: 'Entries',
  rules: 'Rules',
  history: 'History',
  narratives: 'Narratives',
  delete: 'Delete',
  working: 'Working view',
  funder: 'Funder view',
  activity: 'Activity',
  periods: 'Periods',
};

const CROSSWALK_PAGES: Record<string, string> = {
  new: 'New rule',
  matrix: 'Matrix',
  lines: 'Transactions',
  coverage: 'Coverage',
  conflicts: 'Conflicts',
};

async function routeTail(orgId: string, s: string[]): Promise<Crumb[]> {
  const [root, second, third, fourth] = s;
  const at = (n: number) => '/' + s.slice(0, n).join('/');
  switch (root) {
    case undefined:
      return [];
    case 'grants': {
      if (!second) return [];
      if (second === 'new') return [{ label: 'New grant' }];
      if (second === 'rollforward') return [];
      const grant = await prisma.grant.findFirst({
        where: { id: second, orgId },
        select: { name: true },
      });
      const crumbs: Crumb[] = [{ label: grant?.name ?? 'Grant', href: at(2) }];
      if (!third) return crumbs;
      crumbs.push({ label: GRANT_TABS[third] ?? title(third), href: at(3) });
      if (third === 'budget' && fourth === 'import') crumbs.push({ label: 'Import' });
      else if (third === 'periods' && fourth === 'reported') crumbs.push({ label: 'Reported' });
      else if (third === 'rules' && fourth)
        crumbs.push({ label: fourth === 'new' ? 'New rule' : 'Rule' });
      else if (third === 'narratives' && fourth)
        crumbs.push({ label: fourth === 'new' ? 'New narrative' : 'Narrative' });
      return crumbs;
    }
    case 'activity':
      return [];
    case 'import': {
      // Import and Runs live under the activity log (JPH-28 D4); the trail says so.
      if (!second) return [{ label: 'Import' }];
      if (second === 'qbo-report') return [{ label: 'Import', href: '/import' }, { label: 'QuickBooks report' }];
      const batch = await prisma.importBatch.findFirst({
        where: { id: second, orgId },
        select: { startedAt: true },
      });
      const crumbs: Crumb[] = [
        { label: 'Import', href: '/import' },
        { label: batch ? `Batch ${formatDate(batch.startedAt)}` : 'Batch', href: at(2) },
      ];
      if (third === 'changes') crumbs.push({ label: 'Changed and deleted' });
      return crumbs;
    }
    case 'runs': {
      if (!second) return [{ label: TERMS.calculations }];
      const run = await prisma.computeRun.findFirst({
        where: { id: second, orgId },
        select: { startedAt: true },
      });
      const crumbs: Crumb[] = [
        { label: TERMS.calculations, href: '/runs' },
        {
          label: run ? `${TERMS.calculation} ${formatDate(run.startedAt)}` : TERMS.calculation,
          href: at(2),
        },
      ];
      if (third === 'diff') crumbs.push({ label: 'Differences' });
      return crumbs;
    }
    case 'reports':
      if (second === 'custom') return [{ label: 'Custom report' }];
      if (second === 'overview') return [{ label: 'Overview' }];
      if (second === 'lines') return [{ label: 'Transactions' }];
      return [];
    case 'lines':
      return [{ label: 'Transaction' }];
    case 'crosswalk': {
      if (!second) return [];
      if (CROSSWALK_PAGES[second]) return [{ label: CROSSWALK_PAGES[second]! }];
      const rule = await prisma.crosswalkRule.findFirst({
        where: { id: second, orgId },
        select: { name: true },
      });
      const crumbs: Crumb[] = [{ label: rule?.name || 'Rule', href: at(2) }];
      if (third === 'delete') crumbs.push({ label: 'Delete' });
      return crumbs;
    }
    case 'allocation': {
      if (!second) return [];
      if (second === 'new') return [{ label: 'New split' }];
      if (second === 'drivers') return [{ label: 'Drivers' }];
      const rule = await prisma.allocationRule.findFirst({
        where: { id: second, orgId },
        select: { name: true },
      });
      const crumbs: Crumb[] = [{ label: rule?.name || 'Split', href: at(2) }];
      if (third === 'delete') crumbs.push({ label: 'Delete' });
      return crumbs;
    }
    case 'programs': {
      if (!second) return [];
      if (second === 'new') return [{ label: 'New program' }];
      const program = await prisma.program.findFirst({
        where: { id: second, orgId },
        select: { name: true },
      });
      const crumbs: Crumb[] = [{ label: program?.name ?? 'Program', href: at(2) }];
      if (third === 'delete') crumbs.push({ label: 'Delete' });
      return crumbs;
    }
    case 'settings':
      return second === 'periods' ? [{ label: 'Periods' }] : [];
    case 'periods':
      return [{ label: 'Periods', href: '/settings/periods' }, { label: 'Period drift' }];
    default:
      return [];
  }
}

function title(segment: string) {
  return segment.charAt(0).toUpperCase() + segment.slice(1).replaceAll('-', ' ');
}
