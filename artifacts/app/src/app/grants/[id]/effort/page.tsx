import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { FormBanner } from '@/components/form';
import {
  Banner,
  Button,
  Card,
  DataTable,
  DateText,
  KeyFigure,
  Money,
  NumTd,
  StatusPill,
  Th,
  TotalRow,
} from '@/components/ui';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { decodeFormState, pick, pickList } from '@/lib/forms';
import { CATEGORY_KEYS, categoryLabel } from '@/domain/categories';
import { centsToDecimalString } from '@/domain/money';
import { budgetTree } from '@/services/grant-budget';
import { effortSummary, type EffortScheduleView } from '@/services/effort';
import {
  DESTINATION_UNSET_MESSAGE,
  GRANT_CODING_MISSING_MESSAGE,
} from '@/services/correcting-entries';
import { getDefaultDestination, isDestinationSet } from '@/services/settings';
import { EditGrantButton } from '@/app/grants/[id]/edit-grant-button';
import { GrantTabs } from '../tabs';
import {
  carryVarianceAction,
  draftTrueUpAction,
  saveEntryAction,
  saveScheduleAction,
} from './actions';

export const dynamic = 'force-dynamic';

const bpsToPct = (bps: number) => `${(bps / 100).toFixed(2)}%`;

export default async function EffortPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ f?: string; saved?: string; blocked?: string; edit?: string }>;
}) {
  const { id } = await params;
  const { f, saved, blocked, edit } = await searchParams;
  const orgId = await getOrgId();
  const grant = await prisma.grant.findFirst({ where: { id, orgId } });
  if (!grant) notFound();
  const [summary, tree, accounts, people, destination] = await Promise.all([
    effortSummary(orgId, id),
    budgetTree(orgId, id),
    prisma.account.findMany({
      where: { orgId, deletedAt: null },
      orderBy: [{ number: 'asc' }, { name: 'asc' }],
    }),
    prisma.party.findMany({
      where: { orgId, deletedAt: null, kind: 'employee' },
      orderBy: { displayName: 'asc' },
    }),
    getDefaultDestination(orgId),
  ]);
  const state = decodeFormState(f);
  const destinationSet = isDestinationSet(destination);
  const categoryKeys = [...new Set([...CATEGORY_KEYS, ...tree.categoryKeys])];
  const editing = summary.schedules.find((s) => s.id === edit) ?? null;
  const schedules = summary.schedules;

  return (
    <>
      <PageHeader
        title={`${grant.name} · effort`}
        subtitle="Staff time charged by effort (hours × completed occurrences × burdened rate). Matched payroll lines are excluded from direct spend and compared with the charge."
        secondaryActions={<EditGrantButton id={id} />}
      />
      <GrantTabs id={id} active="effort" />
      <FormBanner state={state} saved={!!saved} />
      {blocked ? (
        <div data-testid="draft-blocked">
          <Banner tone="warn">
            No true-up was drafted:{' '}
            {blocked === 'grant' ? (
              <>
                {GRANT_CODING_MISSING_MESSAGE} <Link href={`/grants/${id}/edit`}>Edit grant</Link>.
              </>
            ) : (
              <>
                {DESTINATION_UNSET_MESSAGE} <Link href="/settings#destination">Open settings</Link>.
              </>
            )}
          </Banner>
        </div>
      ) : null}
      {summary.runId === null ? (
        <Banner tone="info">No compute run yet — run a recompute to book the charges.</Banner>
      ) : null}

      <div className="mb-4 grid gap-3 md:grid-cols-4" data-testid="effort-totals">
        <KeyFigure
          label="Effort charged"
          value={<Money cents={summary.effortChargedCents} zero="zero" />}
          hint="current run"
        />
        <KeyFigure
          label="Assigned lines"
          value={<Money cents={summary.assignedLinesCents} zero="zero" />}
          hint="direct + staff + overhead"
        />
        <KeyFigure
          label="Total charged"
          value={
            <span data-testid="total-charged">
              <Money cents={summary.totalChargedCents} zero="zero" />
            </span>
          }
          hint="assigned lines + effort"
        />
        <KeyFigure
          label="Remaining of award"
          value={
            <span data-testid="remaining">
              <Money cents={summary.remainingCents} zero="zero" />
            </span>
          }
          hint={
            <>
              award <Money cents={summary.awardCents} />
            </>
          }
          tone={summary.remainingCents < 0 ? 'bad' : undefined}
        />
      </div>

      {schedules.length === 0 ? (
        <Banner tone="info">No effort schedule yet. Add one below.</Banner>
      ) : null}

      {schedules.map((s) => (
        <ScheduleSection
          key={s.id}
          grantId={id}
          s={s}
          destinationSet={destinationSet}
          activities={tree.activities}
          state={state}
        />
      ))}

      <Card
        title={editing ? `Edit schedule · ${editing.personLabel}` : 'Add effort schedule'}
        action={
          editing ? (
            <Link href={`/grants/${id}/effort`} className="text-sm">
              Cancel edit
            </Link>
          ) : null
        }
      >
        <form
          action={saveScheduleAction.bind(null, id)}
          className="grid gap-3 md:grid-cols-3"
          data-testid="schedule-form"
        >
          {editing ? <input type="hidden" name="scheduleId" value={editing.id} /> : null}
          <div>
            <label htmlFor="personLabel">Person label</label>
            <input
              id="personLabel"
              name="personLabel"
              required
              defaultValue={pick(state, 'personLabel', editing?.personLabel ?? '')}
            />
            {state?.errors['personLabel'] ? (
              <p className="field-error">{state.errors['personLabel']}</p>
            ) : null}
          </div>
          <div>
            <label htmlFor="personPartyId">Employee record (optional)</label>
            <select
              id="personPartyId"
              name="personPartyId"
              defaultValue={pick(state, 'personPartyId', editing?.personPartyId ?? '')}
            >
              <option value="">— none —</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="targetCategoryKey">Target category</label>
            <select
              id="targetCategoryKey"
              name="targetCategoryKey"
              defaultValue={pick(
                state,
                'targetCategoryKey',
                editing?.targetCategoryKey ?? 'coordinator',
              )}
            >
              {categoryKeys.map((k) => (
                <option key={k} value={k}>
                  {categoryLabel(k)} ({k})
                </option>
              ))}
            </select>
            {state?.errors['targetCategoryKey'] ? (
              <p className="field-error">{state.errors['targetCategoryKey']}</p>
            ) : null}
          </div>
          <div>
            <label htmlFor="salary">Annual salary ($)</label>
            <input
              id="salary"
              name="salary"
              inputMode="decimal"
              placeholder="75000.00"
              defaultValue={pick(
                state,
                'salary',
                editing?.salaryCents != null ? centsToDecimalString(editing.salaryCents) : '',
              )}
            />
            <small className="muted">Hourly rate = salary ÷ 2,080</small>
            {state?.errors['salaryCents'] ? (
              <p className="field-error">{state.errors['salaryCents']}</p>
            ) : null}
          </div>
          <div>
            <label htmlFor="hourlyRate">or hourly rate ($/h)</label>
            <input
              id="hourlyRate"
              name="hourlyRate"
              inputMode="decimal"
              defaultValue={pick(state, 'hourlyRate', editing?.hourlyRate ?? '')}
            />
            {state?.errors['hourlyRate'] ? (
              <p className="field-error">{state.errors['hourlyRate']}</p>
            ) : null}
          </div>
          <div>
            <label htmlFor="burdenBps">Burden (basis points)</label>
            <input
              id="burdenBps"
              name="burdenBps"
              inputMode="numeric"
              required
              defaultValue={pick(state, 'burdenBps', String(editing?.burdenBps ?? 765))}
            />
            <small className="muted">765 = 7.65% employer payroll tax</small>
            {state?.errors['burdenBps'] ? (
              <p className="field-error">{state.errors['burdenBps']}</p>
            ) : null}
          </div>
          <div>
            <label htmlFor="accountIds">Actual payroll accounts</label>
            <select
              id="accountIds"
              name="accountIds"
              multiple
              size={5}
              defaultValue={pickList(state, 'accountIds', editing?.matchers.accountIds ?? [])}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.number ? `${a.number} ` : ''}
                  {a.name}
                </option>
              ))}
            </select>
            {state?.errors['actualPayrollMatchers.accountIds'] ? (
              <p className="field-error">{state.errors['actualPayrollMatchers.accountIds']}</p>
            ) : null}
            {state?.errors['actualPayrollMatchers'] ? (
              <p className="field-error" data-testid="matcher-error">
                {state.errors['actualPayrollMatchers']}
              </p>
            ) : null}
          </div>
          <div className="md:col-span-2">
            <label htmlFor="descriptionContainsAny">
              Description contains any of (comma-separated)
            </label>
            <input
              id="descriptionContainsAny"
              name="descriptionContainsAny"
              defaultValue={pick(
                state,
                'descriptionContainsAny',
                (editing?.matchers.descriptionContainsAny ?? []).join(', '),
              )}
            />
            <small className="muted">
              Lines on these accounts whose description contains any keyword are excluded as
              “replaced by effort charge”.
            </small>
            <label className="mt-2 flex items-center gap-2 text-sm font-normal">
              <input
                type="checkbox"
                name="active"
                defaultChecked={
                  state ? pick(state, 'active', '') === 'on' : (editing?.active ?? true)
                }
              />
              Active
            </label>
            {state?.errors['_'] ? <p className="field-error">{state.errors['_']}</p> : null}
          </div>
          <div>
            <Button>{editing ? 'Save schedule' : 'Add schedule'}</Button>
          </div>
        </form>
      </Card>
    </>
  );
}

function ScheduleSection({
  grantId,
  s,
  destinationSet,
  activities,
  state,
}: {
  grantId: string;
  s: EffortScheduleView;
  destinationSet: boolean;
  activities: Array<{ id: string; name: string; completedCount: number }>;
  state: ReturnType<typeof decodeFormState>;
}) {
  const usedActivities = new Set(s.entries.map((e) => e.activityId));
  const unused = activities.filter((a) => !usedActivities.has(a.id));
  const stale = s.entries.some(
    (e) => e.runChargeCents !== null && e.runChargeCents !== e.chargeCents,
  );
  return (
    <section className="mb-4" data-testid="schedule" data-schedule-id={s.id}>
      <Card
        title={
          <>
            {s.personLabel} {s.active ? null : <StatusPill tone="muted">inactive</StatusPill>}
          </>
        }
        action={
          <Link href={`/grants/${grantId}/effort?edit=${s.id}`} className="text-sm">
            Edit schedule
          </Link>
        }
      >
        <dl className="mb-3 grid gap-2 text-sm md:grid-cols-4" data-testid="schedule-terms">
          <div>
            <dt className="muted">Salary</dt>
            <dd>
              {s.salaryCents != null ? (
                <Money cents={s.salaryCents} dollar />
              ) : (
                <>${s.hourlyRate}/h (explicit)</>
              )}
            </dd>
          </div>
          <div>
            <dt className="muted">Hourly rate</dt>
            <dd>
              <span className="num" data-testid="hourly-rate" data-rate={s.rateDisplay}>
                {s.rateDisplay}
              </span>
              /h
            </dd>
          </div>
          <div>
            <dt className="muted">Burden</dt>
            <dd>
              <span data-testid="burden" data-bps={s.burdenBps}>
                {s.burdenBps} bps
              </span>{' '}
              ({bpsToPct(s.burdenBps)})
            </dd>
          </div>
          <div>
            <dt className="muted">Charged to</dt>
            <dd>{categoryLabel(s.targetCategoryKey)} (activity × category)</dd>
          </div>
        </dl>
        {stale ? (
          <Banner tone="warn">
            Inputs changed since the current run — recompute to book the updated charges.
          </Banner>
        ) : null}
        <DataTable caption={`Effort charges · ${s.personLabel}`}>
          <thead>
            <tr>
              <Th>Activity</Th>
              <Th num>Hours / occurrence</Th>
              <Th num>Count</Th>
              <Th num>Total hours</Th>
              <Th num>Charge ($)</Th>
              <Th>Update</Th>
            </tr>
          </thead>
          <tbody>
            {s.entries.map((e) => (
              <tr key={e.entryId} data-activity={e.activityName} data-entry-id={e.entryId}>
                <th scope="row">{e.activityName}</th>
                <td className="num">{e.hoursPerOccurrence}</td>
                <td className="num" data-count={e.count}>
                  {e.count}
                  {e.completedCountOverride !== null ? (
                    <small className="muted block">override (activity: {e.completedCount})</small>
                  ) : null}
                </td>
                <td className="num">{e.hours}</td>
                <NumTd cents={e.chargeCents} data-testid="charge" />
                <td>
                  <form
                    action={saveEntryAction.bind(null, grantId)}
                    className="flex flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="scheduleId" value={s.id} />
                    <input type="hidden" name="activityId" value={e.activityId} />
                    <input type="hidden" name="sortOrder" value={e.sortOrder} />
                    <label className="text-xs">
                      Hours
                      <input
                        name="hoursPerOccurrence"
                        defaultValue={e.hoursPerOccurrence}
                        size={6}
                        aria-label={`Hours per occurrence for ${e.activityName}`}
                      />
                    </label>
                    <label className="text-xs">
                      Count override
                      <input
                        name="completedCountOverride"
                        defaultValue={e.completedCountOverride ?? ''}
                        size={4}
                        placeholder={String(e.completedCount)}
                        aria-label={`Completed count override for ${e.activityName}`}
                      />
                    </label>
                    <Button size="sm" variant="secondary">
                      Save
                    </Button>
                  </form>
                </td>
              </tr>
            ))}
            <TotalRow>
              <Th scope="row">Total charged</Th>
              <td colSpan={3} />
              <NumTd cents={s.chargedCents} data-testid="schedule-total" />
              <td />
            </TotalRow>
          </tbody>
        </DataTable>
        {unused.length > 0 ? (
          <form
            action={saveEntryAction.bind(null, grantId)}
            className="mt-3 flex flex-wrap items-end gap-2"
            data-testid="add-entry"
          >
            <input type="hidden" name="scheduleId" value={s.id} />
            <label className="text-sm">
              Add activity
              <select name="activityId" defaultValue={pick(state, 'activityId', unused[0]!.id)}>
                {unused.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} (completed {a.completedCount})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Hours / occurrence
              <input
                name="hoursPerOccurrence"
                defaultValue={pick(state, 'hoursPerOccurrence', '')}
                size={6}
              />
            </label>
            <label className="text-sm">
              Count override
              <input name="completedCountOverride" size={4} />
            </label>
            <input type="hidden" name="sortOrder" value={(s.entries.length + 1) * 10} />
            <Button size="sm" variant="secondary">
              Add
            </Button>
            {state?.errors['hoursPerOccurrence'] ? (
              <p className="field-error">{state.errors['hoursPerOccurrence']}</p>
            ) : null}
          </form>
        ) : null}
      </Card>

      <Card title="Booked vs. charged" className="mt-3">
        <div className="grid gap-3 md:grid-cols-3" data-testid="booked-vs-charged">
          <KeyFigure
            label="Booked payroll"
            value={
              <span data-testid="booked">
                <Money cents={s.bookedCents} zero="zero" />
              </span>
            }
            hint={
              <>
                {s.bookedLineCount} matched line(s)
                {s.postedTrueUpCents !== 0 ? (
                  <>
                    {' '}
                    incl. posted true-up <Money cents={s.postedTrueUpCents} />
                  </>
                ) : null}
              </>
            }
          />
          <KeyFigure
            label="Charged by effort"
            value={
              <span data-testid="charged">
                <Money cents={s.chargedCents} zero="zero" />
              </span>
            }
          />
          <KeyFigure
            label="Variance (booked − charged)"
            value={
              <span data-testid="variance">
                <Money cents={s.varianceCents} zero="zero" />
              </span>
            }
            tone={s.varianceCents === 0 ? 'ok' : 'warn'}
          />
        </div>
        {s.carriedVarianceCents !== null ? (
          <p className="mt-3 text-sm" data-testid="carried-variance">
            <StatusPill tone="info">carried</StatusPill> Variance of{' '}
            <Money cents={s.carriedVarianceCents} /> carried
            {s.carriedAt ? (
              <>
                {' '}
                on <DateText date={s.carriedAt} />
              </>
            ) : null}
            : <em>{s.carriedVarianceNote}</em>
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-end gap-4">
          <form action={draftTrueUpAction.bind(null, grantId)} data-testid="draft-true-up">
            <input type="hidden" name="scheduleId" value={s.id} />
            <Button disabled={s.varianceCents === 0}>Draft true-up</Button>
            {destinationSet ? null : (
              <small className="muted block">Requires a default destination in Settings.</small>
            )}
          </form>
          <form
            action={carryVarianceAction.bind(null, grantId)}
            className="flex flex-wrap items-end gap-2"
            data-testid="carry-variance"
          >
            <input type="hidden" name="scheduleId" value={s.id} />
            <label className="text-sm">
              Note (required)
              <input name="note" required defaultValue={pick(state, 'note', '')} />
            </label>
            <Button variant="secondary">Carry variance</Button>
            {state?.errors['note'] ? <p className="field-error">{state.errors['note']}</p> : null}
          </form>
        </div>
      </Card>
    </section>
  );
}
