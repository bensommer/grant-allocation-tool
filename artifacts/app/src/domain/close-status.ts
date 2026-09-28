/**
 * Month-end close checklist (JPH-28 D2). Pure: the page gathers the facts, this module turns
 * them into the seven steps the CPA walks through to close a period. Integer cents throughout.
 *
 * Green/amber/red rules are the ticket's table; every judgement call is written up in
 * QUESTIONS.md (JPH-28 section) rather than decided quietly.
 */
import { formatDate, formatMoney } from '@/domain/format';

export type StepTone = 'green' | 'amber' | 'red';
export type StepKey = 'import' | 'review' | 'budgets' | 'effort' | 'entries' | 'export' | 'lock';

export interface CloseStep {
  n: number;
  key: StepKey;
  title: string;
  tone: StepTone;
  /** One-line status shown under the title. */
  status: string;
  /** Short badge text, e.g. "Up to date", "8 waiting", "$143.53 variance". */
  badge: string;
  /** Amount the status is about (integer cents), rendered as data-cents when present. */
  cents?: number;
  /** Count the status is about, rendered as data-count when present. */
  count?: number;
  button: { label: string; href: string };
}

export interface CloseInput {
  asOf: Date;
  now: Date;
  lastImport: { at: Date; status: string } | null;
  /**
   * Needs-review queue across membership-tracked grants: `count` is the rows on grants whose
   * waiting total is not zero (a grant whose rows net to zero — reversal pairs — is settled for
   * this step); `pairs` is the rows that net to zero and can still be confirmed.
   */
  review: { count: number; totalCents: number; pairs: number };
  flaggedGrants: Array<{ id: string; name: string }>;
  /** Health checks of the current calculation that do not pass: `warn` or `fail`. */
  healthWarnings: Array<{ name: string; label: string; status: 'warn' | 'fail' }>;
  /** The newest calculation attempt failed (the numbers shown are the previous one's). */
  lastCalculationFailed: boolean;
  /** Active effort schedules of active grants. */
  effort: Array<{
    grantId: string;
    grantName: string;
    personLabel: string;
    varianceCents: number;
    carried: boolean;
  }>;
  /** Correcting entries drafted but not yet posted in QuickBooks. */
  drafts: Array<{ grantId: string; grantName: string; code: string; amountCents: number }>;
  /** Most recent rollforward export whose period contains the as-of, if any. */
  exportedAt: Date | null;
  /** The period lock containing the as-of, if any. */
  periodLock: { id: string; name: string } | null;
}

export interface CloseStatus {
  steps: CloseStep[];
  /**
   * Every step green and the latest calculation succeeded: the period can be called closed
   * through `asOf`. Never true while the newest calculation attempt failed, because the steps
   * were judged on the previous calculation's numbers.
   */
  closed: boolean;
  /** The step to open by default: the first that is not green. */
  open: StepKey | null;
}

export const IMPORT_FRESH_DAYS = 7;
const DAY_MS = 86_400_000;

function days(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

const money = (cents: number) => formatMoney(cents, { dollar: true, zero: 'zero' });

export function closeStatus(input: CloseInput): CloseStatus {
  const steps: CloseStep[] = [
    importStep(input),
    reviewStep(input),
    budgetsStep(input),
    effortStep(input),
    entriesStep(input),
    exportStep(input),
    lockStep(input),
  ];
  const open = steps.find((s) => s.tone !== 'green')?.key ?? null;
  return { steps, closed: open === null && !input.lastCalculationFailed, open };
}

function importStep({ asOf, now, lastImport }: CloseInput): CloseStep {
  const base = { n: 1, key: 'import' as const, title: 'Import QuickBooks' };
  const button = { label: 'Import', href: '/import' };
  if (!lastImport)
    return { ...base, tone: 'red', status: 'No QuickBooks data imported yet.', badge: 'Not started', button };
  if (lastImport.status === 'failed')
    return {
      ...base,
      tone: 'red',
      status: `The last import failed (${formatDate(lastImport.at)}).`,
      badge: 'Import failed',
      button,
    };
  const ago = days(lastImport.at, now);
  const fresh = lastImport.at.getTime() >= asOf.getTime() - IMPORT_FRESH_DAYS * DAY_MS;
  if (fresh)
    return {
      ...base,
      tone: 'green',
      status: `Last import ${formatDate(lastImport.at)}${ago === 0 ? ' (today)' : ` (${plural(ago, 'day')} ago)`}.`,
      badge: 'Up to date',
      button,
    };
  return {
    ...base,
    tone: 'amber',
    status: `Last import ${plural(ago, 'day')} ago (${formatDate(lastImport.at)}) — more than ${IMPORT_FRESH_DAYS} days before the as-of date.`,
    badge: `Last import ${plural(ago, 'day')} ago`,
    count: ago,
    button,
  };
}

function reviewStep({ review }: CloseInput): CloseStep {
  const base = { n: 2, key: 'review' as const, title: 'Review transactions' };
  if (review.totalCents === 0) {
    const pairs = review.pairs
      ? ` ${plural(review.pairs, 'reversal pair')} to confirm — they net to zero.`
      : '';
    return {
      ...base,
      tone: 'green',
      status: `Nothing waiting for a decision.${pairs}`,
      badge: 'Done',
      cents: 0,
      count: review.count,
      button: { label: 'Review', href: '/review' },
    };
  }
  return {
    ...base,
    tone: 'amber',
    status: `${plural(review.count, 'transaction')} need a decision · ${money(review.totalCents)}.`,
    badge: `${review.count.toLocaleString('en-US')} waiting`,
    cents: review.totalCents,
    count: review.count,
    button: { label: `Review ${review.count.toLocaleString('en-US')}`, href: '/review' },
  };
}

function budgetsStep({ flaggedGrants, healthWarnings }: CloseInput): CloseStep {
  const base = { n: 3, key: 'budgets' as const, title: 'Check budgets & pacing' };
  const button = { label: 'See budgets', href: '/restricted' };
  if (flaggedGrants.length === 0 && healthWarnings.length === 0)
    return {
      ...base,
      tone: 'green',
      status: 'No grant is flagged and every health check passes.',
      badge: 'All clear',
      count: 0,
      button,
    };
  const failing = healthWarnings.filter((w) => w.status === 'fail');
  const warning = healthWarnings.filter((w) => w.status !== 'fail');
  const parts: string[] = [];
  if (failing.length)
    parts.push(
      `${plural(failing.length, 'health check')} fail${failing.length === 1 ? 's' : ''}: ${failing.map((w) => w.label).join(', ')}`,
    );
  if (flaggedGrants.length)
    parts.push(
      `${plural(flaggedGrants.length, 'flagged grant')}: ${flaggedGrants.map((g) => g.name).join(', ')}`,
    );
  if (warning.length)
    parts.push(
      `${plural(warning.length, 'health check')} warn${warning.length === 1 ? 's' : ''}: ${warning.map((w) => w.label).join(', ')}`,
    );
  return {
    ...base,
    // A failed check means the calculation's own numbers do not reconcile: a blocker, not a to-do.
    tone: failing.length ? 'red' : 'amber',
    status: `${parts.join(' · ')}.`,
    badge: [
      failing.length ? `${failing.length} fail` : null,
      flaggedGrants.length ? `${flaggedGrants.length} flagged` : null,
      warning.length ? `${warning.length} warn` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    count: flaggedGrants.length + healthWarnings.length,
    button,
  };
}

function effortStep({ effort }: CloseInput): CloseStep {
  const base = { n: 4, key: 'effort' as const, title: 'Confirm staff time vs. payroll' };
  const open = effort.filter((s) => s.varianceCents !== 0 && !s.carried);
  const first = open[0] ?? effort[0];
  const button = {
    label: 'Review',
    href: first ? `/grants/${first.grantId}/effort` : '/grants',
  };
  if (open.length === 0)
    return {
      ...base,
      tone: 'green',
      status: effort.length
        ? `Every schedule's variance is 0 or carried forward (${plural(effort.length, 'schedule')}).`
        : 'No staff time schedules to confirm.',
      badge: 'Matches payroll',
      cents: 0,
      count: 0,
      button,
    };
  const variance = open.reduce((n, s) => n + Math.abs(s.varianceCents), 0);
  return {
    ...base,
    tone: 'amber',
    status: `${money(variance)} between booked payroll and staff time across ${plural(open.length, 'schedule')}: ${open
      .map((s) => `${s.personLabel} (${s.grantName})`)
      .join(', ')}.`,
    badge: `${money(variance)} variance`,
    cents: variance,
    count: open.length,
    button,
  };
}

function entriesStep({ drafts }: CloseInput): CloseStep {
  const base = { n: 5, key: 'entries' as const, title: 'Post correcting entries' };
  const first = drafts[0];
  const button = {
    label: 'Export',
    href: first ? `/grants/${first.grantId}/entries` : '/grants',
  };
  if (drafts.length === 0)
    return {
      ...base,
      tone: 'green',
      status: 'No drafted entries waiting to be posted in QuickBooks.',
      badge: 'Nothing to post',
      cents: 0,
      count: 0,
      button,
    };
  const total = drafts.reduce((n, d) => n + d.amountCents, 0);
  return {
    ...base,
    tone: 'amber',
    status: `${plural(drafts.length, 'entry', 'entries')} drafted (${money(total)}): ${drafts
      .map((d) => `${d.code} — ${d.grantName}`)
      .join(', ')}. Export, post in QuickBooks, then re-import.`,
    badge: `${plural(drafts.length, 'entry', 'entries')} to post`,
    cents: total,
    count: drafts.length,
    button,
  };
}

function exportStep({ asOf, exportedAt }: CloseInput): CloseStep {
  const base = { n: 6, key: 'export' as const, title: 'Export rollforward' };
  const button = { label: 'Export', href: '/grants/rollforward' };
  if (exportedAt)
    return {
      ...base,
      tone: 'green',
      status: `Rollforward exported ${formatDate(exportedAt)} for the period through ${formatDate(asOf)}.`,
      badge: 'Exported',
      button,
    };
  return {
    ...base,
    tone: 'amber',
    status: `No rollforward export yet for the period through ${formatDate(asOf)}.`,
    badge: 'Not exported',
    button,
  };
}

function lockStep({ asOf, periodLock }: CloseInput): CloseStep {
  const base = { n: 7, key: 'lock' as const, title: 'Lock period' };
  const button = { label: 'Lock', href: '/settings/periods' };
  if (periodLock)
    return {
      ...base,
      tone: 'green',
      status: `Locked as "${periodLock.name}".`,
      badge: 'Locked',
      button: { label: 'View lock', href: '/settings/periods' },
    };
  return {
    ...base,
    tone: 'amber',
    status: `The period through ${formatDate(asOf)} is not locked yet.`,
    badge: 'Not locked',
    button,
  };
}
