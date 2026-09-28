import Link from 'next/link';
import { Banner, StatusPill } from '@/components/ui';
import { getOrgId } from '@/lib/org';
import { currentPeriod } from '@/lib/period';
import { grantTracking, loadGrant } from '@/services/grant-figures';
import { toReviewCount } from '@/domain/grant-figures';
import { grantTodo, setupNeedsAttention } from '@/services/grant-todo';

/**
 * Page keys the workspace pages pass. Each maps onto one of the three tabs (JPH-29 E1):
 * Status, To do, Setup. The old keys stay so every existing page keeps its one-line call.
 */
export type GrantTab =
  | 'detail'
  | 'todo'
  | 'funder'
  | 'working'
  | 'activity'
  | 'review'
  | 'rules'
  | 'effort'
  | 'entries'
  | 'periods'
  | 'bva'
  | 'budget'
  | 'history'
  | 'narratives'
  | 'edit';

export type TopTab = 'status' | 'todo' | 'setup';

export const TOP_TAB_OF: Record<GrantTab, TopTab> = {
  detail: 'status',
  funder: 'status',
  working: 'status',
  bva: 'status',
  activity: 'setup',
  todo: 'todo',
  review: 'todo',
  effort: 'todo',
  entries: 'todo',
  edit: 'setup',
  budget: 'setup',
  rules: 'setup',
  periods: 'setup',
  history: 'setup',
  narratives: 'setup',
};

/** Pages whose content is the transaction pipeline (review, rules, effort, entries, periods). */
const MEMBER_LINE_TABS: ReadonlySet<GrantTab> = new Set([
  'todo',
  'review',
  'rules',
  'effort',
  'entries',
  'periods',
]);

/**
 * Grant workspace navigation: three tabs. Status (the numbers), To do (what needs a decision),
 * Setup (how the grant is defined). The tracking badge sits above the tabs on every grant page;
 * a crosswalk-tracked grant gets one explanatory notice on the transaction pages instead of
 * their empty queues.
 */
export async function GrantTabs({ id, active }: { id: string; active: GrantTab }) {
  const orgId = await getOrgId();
  const period = await currentPeriod(orgId, {});
  const [tracking, loaded, todo] = await Promise.all([
    grantTracking(orgId, id),
    loadGrant(orgId, id, new Date()),
    grantTodo(orgId, id, period),
  ]);
  const setup = await setupNeedsAttention(orgId, id, tracking?.mode ?? null);
  // JPH-27 C5: the header chip counts transactions to decide on, net of proposed reversal pairs.
  const toReview = loaded ? toReviewCount(loaded.needsReview) : 0;
  const base = `/grants/${id}`;
  const top = TOP_TAB_OF[active];
  const crosswalkNotice = tracking?.mode === 'crosswalk' && MEMBER_LINE_TABS.has(active);
  const tabs: Array<{ key: TopTab; href: string; label: string }> = [
    { key: 'status', href: base, label: 'Status' },
    { key: 'todo', href: `${base}/todo`, label: 'To do' },
    { key: 'setup', href: `${base}/edit`, label: 'Setup' },
  ];
  return (
    <>
      {tracking && (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span data-testid="tracking-badge" data-mode={tracking.mode}>
            <StatusPill tone="muted" icon="◦">
              {tracking.label}
            </StatusPill>
          </span>
          {toReview > 0 ? (
            <Link
              href={`${base}/review`}
              className="no-underline"
              data-testid="review-chip"
              data-count={toReview}
            >
              <StatusPill tone="warn">{toReview} to review</StatusPill>
            </Link>
          ) : null}
        </p>
      )}
      <nav className="no-print mb-4 border-b border-line" aria-label="Grant workspace">
        <div className="flex max-w-full gap-1 overflow-x-auto" data-testid="grant-tabs">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={t.href}
              data-testid={`tab-${t.key}`}
              aria-current={t.key === top ? 'page' : undefined}
              className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm hover:no-underline ${t.key === top ? 'border-harbor font-semibold text-ink' : 'border-transparent text-ink-soft'}`}
            >
              {t.label}
              {t.key === 'todo' && todo.openCount > 0 ? (
                <span
                  className="tab-count"
                  data-testid="review-tab-count"
                  data-count={todo.openCount}
                >
                  {todo.openCount}
                  <span className="sr-only"> items waiting</span>
                </span>
              ) : null}
              {t.key === 'setup' && setup.dot ? (
                <span
                  className="ml-1 inline-block h-2 w-2 rounded-full bg-amber-500 align-middle"
                  data-testid="setup-dot"
                  data-difference-cents={setup.differenceCents}
                  title={
                    setup.differenceCents !== 0
                      ? 'Working lines do not add up to the funder budget'
                      : 'No rules yet'
                  }
                >
                  <span className="sr-only">
                    {setup.differenceCents !== 0
                      ? ' Working lines do not add up to the funder budget'
                      : ' No rules yet'}
                  </span>
                </span>
              ) : null}
            </Link>
          ))}
        </div>
      </nav>
      {crosswalkNotice && (
        <div data-testid="crosswalk-notice">
          <Banner tone="info">
            This grant is tracked by crosswalk rules, so it has no QuickBooks transactions of its
            own. To use the review queue, rules, effort and entries, set how QuickBooks tracks it on{' '}
            <Link href={`${base}/edit`}>Edit grant</Link>.
          </Banner>
        </div>
      )}
    </>
  );
}
