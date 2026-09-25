/**
 * Effort schedules (JPH-22, JPH-19 §6 F): staff time charged by effort instead
 * of booked payroll. The pure math is src/domain/effort.ts; the grant stage
 * (src/engine/grant-stage.ts) emits the charges and excludes the matched
 * payroll lines. This service owns the schedule rows, the config loader and
 * the booked-vs-charged summary.
 */
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { zodErrors } from '@/lib/zod-errors';
import { markCurrentRunStale } from '@/lib/stale';
import { categoryKeyPattern } from '@/domain/categories';
import {
  computeEffortCharges,
  effortHourlyRate,
  formatRate,
  EffortInputError,
  type EffortCharge,
} from '@/domain/effort';
import { matchersSchema, parseMatchers, type Matchers } from '@/domain/matchers';
import { EFFORT_REPLACED_REASON, type GrantStageSchedule } from '@/engine/grant-stage';
import { ValidationError } from './programs';
import { booksThrough, grantFiguresFor } from './grant-figures';
import { assertMatcherRefs } from './refs';

const decimalString = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, 'Enter a positive decimal number');

export const EMPTY_MATCHER_MESSAGE =
  'An active schedule needs payroll matchers: pick at least one payroll account or a description keyword (an empty matcher would match every line on the grant).';

/** True when the matchers restrict by account, account range, or description text. */
export function hasPayrollMatcher(m: Matchers): boolean {
  return !!(
    m.accountIds?.length ||
    m.accountRange ||
    m.descriptionContains?.trim() ||
    m.descriptionContainsAny?.some((x) => x.trim())
  );
}

export const scheduleInputSchema = z
  .object({
    personLabel: z.string().trim().min(1, 'Person label is required').max(120),
    personPartyId: z.string().nullable(),
    salaryCents: z.number().int().positive('Salary must be positive').nullable(),
    hourlyRate: decimalString.nullable(),
    burdenBps: z.number().int('Burden must be whole basis points').min(0).max(50_000),
    targetCategoryKey: z
      .string()
      .regex(categoryKeyPattern, 'Category key: lower-case letters, digits, underscore'),
    actualPayrollMatchers: matchersSchema,
    active: z.boolean(),
  })
  .refine((s) => s.salaryCents !== null || s.hourlyRate !== null, {
    message: 'Enter an annual salary or an hourly rate',
    path: ['salaryCents'],
  })
  // Empty matchers match every line; an active schedule with them would exclude the
  // grant's whole expense side as "replaced by effort charge".
  .refine((s) => !s.active || hasPayrollMatcher(s.actualPayrollMatchers), {
    message: EMPTY_MATCHER_MESSAGE,
    path: ['actualPayrollMatchers'],
  });
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;

export const entryInputSchema = z.object({
  activityId: z.string().min(1, 'Select an activity'),
  hoursPerOccurrence: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, 'Hours: a number with at most two decimals'),
  completedCountOverride: z.number().int().min(0).nullable(),
  sortOrder: z.number().int(),
});
export type EntryInput = z.infer<typeof entryInputSchema>;

async function validateSchedule(orgId: string, grantId: string, input: ScheduleInput) {
  const r = scheduleInputSchema.safeParse(input);
  if (!r.success) throw new ValidationError(zodErrors(r.error));
  const d = r.data;
  const grant = await prisma.grant.findFirst({ where: { id: grantId, orgId } });
  if (!grant) throw new ValidationError({ _: 'Grant not found' });
  if (d.personPartyId) {
    const p = await prisma.party.findFirst({ where: { id: d.personPartyId, orgId } });
    if (!p) throw new ValidationError({ personPartyId: 'Person not found' });
  }
  try {
    effortHourlyRate({ salaryCents: d.salaryCents, hourlyRate: d.hourlyRate, burdenBps: 0 });
  } catch (e) {
    if (e instanceof EffortInputError) throw new ValidationError({ salaryCents: e.message });
    throw e;
  }
  await assertMatcherRefs(prisma, orgId, d.actualPayrollMatchers);
  return d;
}

export async function createSchedule(
  orgId: string,
  grantId: string,
  input: ScheduleInput,
  actor = 'local-user',
) {
  const d = await validateSchedule(orgId, grantId, input);
  return prisma.$transaction(async (tx) => {
    const row = await tx.effortSchedule.create({
      data: {
        orgId,
        grantId,
        personLabel: d.personLabel,
        personPartyId: d.personPartyId,
        salaryCents: d.salaryCents,
        hourlyRate: d.hourlyRate,
        burdenBps: d.burdenBps,
        targetCategoryKey: d.targetCategoryKey,
        actualPayrollMatchers: d.actualPayrollMatchers as Prisma.InputJsonValue,
        active: d.active,
      },
    });
    await recordAudit(tx, {
      orgId,
      entity: 'EffortSchedule',
      entityId: row.id,
      action: 'create',
      after: row,
      actor,
    });
    await markCurrentRunStale(tx, orgId);
    return row;
  });
}

export async function updateSchedule(
  orgId: string,
  grantId: string,
  scheduleId: string,
  input: ScheduleInput,
  actor = 'local-user',
) {
  const d = await validateSchedule(orgId, grantId, input);
  const before = await prisma.effortSchedule.findFirst({
    where: { id: scheduleId, orgId, grantId },
  });
  if (!before) throw new ValidationError({ _: 'Schedule not found' });
  return prisma.$transaction(async (tx) => {
    const row = await tx.effortSchedule.update({
      where: { id: scheduleId },
      data: {
        personLabel: d.personLabel,
        personPartyId: d.personPartyId,
        salaryCents: d.salaryCents,
        hourlyRate: d.hourlyRate,
        burdenBps: d.burdenBps,
        targetCategoryKey: d.targetCategoryKey,
        actualPayrollMatchers: d.actualPayrollMatchers as Prisma.InputJsonValue,
        active: d.active,
      },
    });
    await recordAudit(tx, {
      orgId,
      entity: 'EffortSchedule',
      entityId: row.id,
      action: 'update',
      before,
      after: row,
      actor,
    });
    await markCurrentRunStale(tx, orgId);
    return row;
  });
}

/** Creates or updates the entry for (schedule, activity). */
export async function upsertEntry(
  orgId: string,
  grantId: string,
  scheduleId: string,
  input: EntryInput,
  actor = 'local-user',
) {
  const r = entryInputSchema.safeParse(input);
  if (!r.success) throw new ValidationError(zodErrors(r.error));
  const d = r.data;
  const schedule = await prisma.effortSchedule.findFirst({
    where: { id: scheduleId, orgId, grantId },
  });
  if (!schedule) throw new ValidationError({ _: 'Schedule not found' });
  const activity = await prisma.grantActivity.findFirst({
    where: { id: d.activityId, orgId, grantId },
  });
  if (!activity) throw new ValidationError({ activityId: 'Activity not found' });
  return prisma.$transaction(async (tx) => {
    const before = await tx.effortEntry.findUnique({
      where: { scheduleId_activityId: { scheduleId, activityId: d.activityId } },
    });
    const data = {
      hoursPerOccurrence: d.hoursPerOccurrence,
      completedCountOverride: d.completedCountOverride,
      sortOrder: d.sortOrder,
    };
    const row = before
      ? await tx.effortEntry.update({ where: { id: before.id }, data })
      : await tx.effortEntry.create({
          data: { orgId, scheduleId, activityId: d.activityId, ...data },
        });
    await recordAudit(tx, {
      orgId,
      entity: 'EffortEntry',
      entityId: row.id,
      action: before ? 'update' : 'create',
      before: before ?? undefined,
      after: row,
      actor,
    });
    await markCurrentRunStale(tx, orgId);
    return row;
  });
}

/** Records that the current variance is carried rather than trued up (note required). */
export async function carryVariance(
  orgId: string,
  grantId: string,
  scheduleId: string,
  note: string,
  actor = 'local-user',
) {
  const trimmed = note.trim();
  if (!trimmed) throw new ValidationError({ note: 'A note is required to carry a variance' });
  const summary = await effortSummary(orgId, grantId);
  const s = summary.schedules.find((x) => x.id === scheduleId);
  if (!s) throw new ValidationError({ _: 'Schedule not found' });
  return prisma.$transaction(async (tx) => {
    const before = await tx.effortSchedule.findUniqueOrThrow({ where: { id: scheduleId } });
    const row = await tx.effortSchedule.update({
      where: { id: scheduleId },
      data: {
        carriedVarianceCents: s.varianceCents,
        carriedVarianceNote: trimmed,
        carriedAt: new Date(),
      },
    });
    await recordAudit(tx, {
      orgId,
      entity: 'EffortSchedule',
      entityId: scheduleId,
      action: 'update',
      before: {
        carriedVarianceCents: before.carriedVarianceCents,
        carriedVarianceNote: before.carriedVarianceNote,
      },
      after: { carriedVarianceCents: s.varianceCents, carriedVarianceNote: trimmed },
      actor,
    });
    return row;
  });
}

/** Grant-stage config: active schedules with entries and the activities' completed counts. */
export async function loadStageSchedules(orgId: string): Promise<GrantStageSchedule[]> {
  const rows = await prisma.effortSchedule.findMany({
    where: { orgId, active: true, grant: { status: { not: 'archived' } } },
    include: {
      entries: { include: { activity: { select: { completedCount: true } } } },
    },
    orderBy: { id: 'asc' },
  });
  return rows.map((s) => ({
    id: s.id,
    grantId: s.grantId,
    salaryCents: s.salaryCents,
    hourlyRate: s.hourlyRate === null ? null : s.hourlyRate.toString(),
    burdenBps: s.burdenBps,
    targetCategoryKey: s.targetCategoryKey,
    matchers: parseMatchers(s.actualPayrollMatchers),
    entries: s.entries.map((e) => ({
      id: e.id,
      activityId: e.activityId,
      hoursPerOccurrence: e.hoursPerOccurrence.toString(),
      completedCount: e.activity.completedCount,
      completedCountOverride: e.completedCountOverride,
      sortOrder: e.sortOrder,
    })),
  }));
}

export interface EffortEntryView extends EffortCharge {
  activityName: string;
  completedCount: number;
  completedCountOverride: number | null;
  sortOrder: number;
  /** Charge stored in the current run (null when the run predates the entry). */
  runChargeCents: number | null;
}

export interface EffortScheduleView {
  id: string;
  personLabel: string;
  personPartyId: string | null;
  salaryCents: number | null;
  hourlyRate: string | null;
  /** Unburdened hourly rate for display, 4 decimals. */
  rateDisplay: string;
  burdenBps: number;
  targetCategoryKey: string;
  matchers: Matchers;
  active: boolean;
  entries: EffortEntryView[];
  /** Σ charges from the schedule's current inputs. */
  chargedCents: number;
  /** Booked payroll the schedule replaces (current run) + posted true-up lines. */
  bookedCents: number;
  bookedPayrollCents: number;
  postedTrueUpCents: number;
  bookedLineCount: number;
  /** booked − charged. */
  varianceCents: number;
  carriedVarianceCents: number | null;
  carriedVarianceNote: string | null;
  carriedAt: Date | null;
  /** Account ids of the matched payroll lines, most cents first (true-up account choice). */
  bookedAccounts: Array<{ accountId: string; accountName: string; cents: number }>;
}

export interface EffortSummary {
  runId: string | null;
  schedules: EffortScheduleView[];
  /** Σ effort charges in the current run for the grant. */
  effortChargedCents: number;
  /** Σ dated spend through `asOf` (assigned lines or crosswalk pieces by tracking mode). */
  assignedLinesCents: number;
  /** assigned lines + effort charges — the grant's spent figure at `asOf`. */
  totalChargedCents: number;
  awardCents: number;
  remainingCents: number;
  asOf: Date;
}

/**
 * The effort page: schedules with their booked payroll, and the header cards read
 * from the grant's figures at `asOf` (books-through by default) so they match the
 * overview (JPH-30).
 */
export async function effortSummary(
  orgId: string,
  grantId: string,
  asOf?: Date,
): Promise<EffortSummary> {
  const [figures, run, schedules] = await Promise.all([
    grantFiguresFor(orgId, grantId, asOf ?? (await booksThrough(orgId))),
    prisma.computeRun.findFirst({ where: { orgId, isCurrent: true }, select: { id: true } }),
    prisma.effortSchedule.findMany({
      where: { orgId, grantId },
      include: {
        entries: { include: { activity: { select: { name: true, completedCount: true } } } },
        drafts: { where: { kind: 'true_up', status: 'posted' }, select: { code: true } },
      },
      orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
    }),
  ]);
  const results = run
    ? await prisma.grantLineResult.findMany({
        where: { computeRunId: run.id, grantId },
        select: {
          source: true,
          state: true,
          reason: true,
          amountCents: true,
          effortEntryId: true,
          effortScheduleId: true,
          line: { select: { accountId: true, account: { select: { name: true } } } },
        },
      })
    : [];
  if (!figures) throw new Error('Grant not found');
  const runCharge = new Map(
    results.filter((r) => r.effortEntryId).map((r) => [r.effortEntryId!, r.amountCents]),
  );

  const views: EffortScheduleView[] = schedules.map((s) => {
    const input = {
      salaryCents: s.salaryCents,
      hourlyRate: s.hourlyRate === null ? null : s.hourlyRate.toString(),
      burdenBps: s.burdenBps,
    };
    const entries = s.entries.map((e) => ({
      id: e.id,
      activityId: e.activityId,
      hoursPerOccurrence: e.hoursPerOccurrence.toString(),
      completedCount: e.activity.completedCount,
      completedCountOverride: e.completedCountOverride,
      sortOrder: e.sortOrder,
    }));
    const computed = computeEffortCharges(input, entries);
    const byEntry = new Map(entries.map((e) => [e.id, e]));
    const activityName = new Map(s.entries.map((e) => [e.id, e.activity.name]));
    const matched = results.filter(
      (r) =>
        r.source === 'transaction' &&
        r.effortScheduleId === s.id &&
        r.reason === EFFORT_REPLACED_REASON,
    );
    const bookedPayrollCents = matched.reduce((t, r) => t + r.amountCents, 0);
    const postedCodes = new Set(s.drafts.map((d) => `posted correcting entry ${d.code}`));
    const postedTrueUpCents = results
      .filter((r) => r.source === 'transaction' && r.reason && postedCodes.has(r.reason))
      .reduce((t, r) => t + r.amountCents, 0);
    const accounts = new Map<string, { accountId: string; accountName: string; cents: number }>();
    for (const r of matched) {
      if (!r.line) continue;
      const a = accounts.get(r.line.accountId) ?? {
        accountId: r.line.accountId,
        accountName: r.line.account.name,
        cents: 0,
      };
      a.cents += r.amountCents;
      accounts.set(r.line.accountId, a);
    }
    const bookedCents = bookedPayrollCents + postedTrueUpCents;
    return {
      id: s.id,
      personLabel: s.personLabel,
      personPartyId: s.personPartyId,
      salaryCents: s.salaryCents,
      hourlyRate: input.hourlyRate,
      rateDisplay: formatRate(computed.hourlyRate),
      burdenBps: s.burdenBps,
      targetCategoryKey: s.targetCategoryKey,
      matchers: parseMatchers(s.actualPayrollMatchers),
      active: s.active,
      entries: computed.charges.map((c) => ({
        ...c,
        activityName: activityName.get(c.entryId) ?? '?',
        completedCount: byEntry.get(c.entryId)!.completedCount,
        completedCountOverride: byEntry.get(c.entryId)!.completedCountOverride,
        sortOrder: byEntry.get(c.entryId)!.sortOrder,
        runChargeCents: runCharge.get(c.entryId) ?? null,
      })),
      chargedCents: computed.totalCents,
      bookedCents,
      bookedPayrollCents,
      postedTrueUpCents,
      bookedLineCount: matched.length,
      varianceCents: bookedCents - computed.totalCents,
      carriedVarianceCents: s.carriedVarianceCents,
      carriedVarianceNote: s.carriedVarianceNote,
      carriedAt: s.carriedAt,
      bookedAccounts: [...accounts.values()].sort(
        (a, b) =>
          Math.abs(b.cents) - Math.abs(a.cents) || a.accountName.localeCompare(b.accountName),
      ),
    };
  });
  const f = figures.figures;
  return {
    runId: run?.id ?? null,
    schedules: views,
    effortChargedCents: f.effortCents,
    assignedLinesCents: f.spentCents - f.effortCents,
    totalChargedCents: f.spentCents,
    awardCents: f.awardCents,
    remainingCents: f.remainingAwardCents,
    asOf: f.asOf,
  };
}
