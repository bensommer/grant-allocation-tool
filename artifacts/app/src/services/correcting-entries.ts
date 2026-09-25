/**
 * Correcting-entry drafts (JPH-22, JPH-19 §6 G). Drafts are built by the pure
 * builders in src/domain/correcting-entry.ts, saved here with a per-org
 * sequential code (GAT-0001, …) and exported for a human to post in
 * QuickBooks. Nothing here writes to QuickBooks. Drafts are voided, never
 * deleted. A draft becomes `posted` when a re-import contains a member journal
 * entry whose memo/description carries the code and whose grant-side total
 * matches (`detectPostedEntries`).
 */
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { markCurrentRunStale } from '@/lib/stale';
import {
  assertBalanced,
  buildReclassLines,
  buildTrueUpLines,
  carriesCode,
  grantSideCents,
  isCoded,
  type Destination,
  type EntryLineDraft,
} from '@/domain/correcting-entry';
import type { GrantStagePostedLine } from '@/engine/grant-stage';
import { effortSummary } from './effort';
import { ValidationError } from './programs';
import { getDefaultDestination, isDestinationSet } from './settings';

type Db = Prisma.TransactionClient | typeof prisma;

export const CODE_PREFIX = 'GAT-';
export const DESTINATION_UNSET_MESSAGE =
  'Set a default destination (class or project) in Settings before drafting correcting entries.';

export class DestinationUnsetError extends ValidationError {
  constructor() {
    super({ _: DESTINATION_UNSET_MESSAGE });
    this.name = 'DestinationUnsetError';
  }
}

function formatCode(n: number): string {
  return `${CODE_PREFIX}${String(n).padStart(4, '0')}`;
}

/** Next sequential code for the org; call inside the saving transaction. */
export async function allocateCode(tx: Db, orgId: string): Promise<string> {
  // Serialize allocation per org: the Org row lock makes concurrent drafts queue.
  await tx.$executeRaw`SELECT id FROM "Org" WHERE id = ${orgId} FOR UPDATE`;
  const last = await tx.correctingEntryDraft.findFirst({
    where: { orgId, code: { startsWith: CODE_PREFIX } },
    orderBy: { code: 'desc' },
    select: { code: true },
  });
  const n = last ? Number(last.code.slice(CODE_PREFIX.length)) + 1 : 1;
  return formatCode(n);
}

export const GRANT_CODING_MISSING_MESSAGE =
  'This grant has no QuickBooks class or project. Set "QuickBooks class" or "QuickBooks project" on the grant (Edit grant) so the grant side of the entry can be coded.';

export class GrantCodingUnsetError extends ValidationError {
  constructor() {
    super({ _: GRANT_CODING_MISSING_MESSAGE });
    this.name = 'GrantCodingUnsetError';
  }
}

async function resolveNames(orgId: string, classId: string | null, partyId: string | null) {
  const [cls, party] = await Promise.all([
    classId ? prisma.trackingClass.findFirst({ where: { id: classId, orgId } }) : null,
    partyId ? prisma.party.findFirst({ where: { id: partyId, orgId } }) : null,
  ]);
  return { className: cls?.name ?? null, partyName: party?.displayName ?? null };
}

async function requireDestination(orgId: string): Promise<Destination> {
  const d = await getDefaultDestination(orgId);
  if (!isDestinationSet(d)) throw new DestinationUnsetError();
  const names = await resolveNames(orgId, d.classId, d.partyId);
  const dest = { classId: d.classId, partyId: d.partyId, ...names };
  if (!isCoded(dest)) throw new DestinationUnsetError();
  return dest;
}

/**
 * How the grant side of an entry is coded in QuickBooks. The exported names
 * come first from the grant's explicit `qboClassName` / `qboProjectName` (the
 * class *full* name — `Parent:Child` — and project the books use, which
 * scoped report exports do not carry as rows and which a ledger class row
 * only knows by its leaf segment); otherwise from the membership class /
 * project rows. Ledger ids are kept when the membership ids are set. Throws
 * GrantCodingUnsetError when neither names a class or a project, so a draft
 * whose grant-side lines would post nowhere is never created.
 */
export async function grantDestination(orgId: string, grantId: string): Promise<Destination> {
  const g = await prisma.grant.findFirstOrThrow({ where: { id: grantId, orgId } });
  const classId = g.memberClassIds[0] ?? null;
  const partyId = g.memberPartyIds[0] ?? null;
  const names = await resolveNames(orgId, classId, partyId);
  const blankToNull = (x: string | null | undefined) => (x?.trim() ? x.trim() : null);
  const dest: Destination = {
    classId,
    partyId,
    className: blankToNull(g.qboClassName) ?? blankToNull(names.className),
    partyName: blankToNull(g.qboProjectName) ?? blankToNull(names.partyName),
  };
  if (!isCoded(dest)) throw new GrantCodingUnsetError();
  return dest;
}

export interface SaveDraftInput {
  grantId: string;
  kind: 'reclass' | 'true_up';
  date: Date;
  memo: string;
  sourceDecisionGroupId?: string | null;
  sourceScheduleId?: string | null;
  /** Builder receives the allocated code so descriptions/memo can carry it. */
  build: (code: string) => { lines: EntryLineDraft[]; memo?: string };
}

/**
 * Saves a draft. The balance check runs here, on the built lines, so an
 * unbalanced draft can never be stored regardless of which UI produced it.
 */
export async function saveDraft(orgId: string, input: SaveDraftInput, actor = 'local-user') {
  const grant = await prisma.grant.findFirst({ where: { id: input.grantId, orgId } });
  if (!grant) throw new ValidationError({ _: 'Grant not found' });
  return prisma.$transaction(async (tx) => {
    const code = await allocateCode(tx, orgId);
    const built = input.build(code);
    assertBalanced(built.lines);
    const memo = (built.memo ?? input.memo).trim();
    if (!memo.includes(code)) throw new ValidationError({ memo: `Memo must include ${code}` });
    const draft = await tx.correctingEntryDraft.create({
      data: {
        orgId,
        grantId: input.grantId,
        code,
        kind: input.kind,
        status: 'drafted',
        sourceDecisionGroupId: input.sourceDecisionGroupId ?? null,
        sourceScheduleId: input.sourceScheduleId ?? null,
        date: input.date,
        memo,
        actor,
        lines: {
          create: built.lines.map((l, i) => ({
            orgId,
            lineNumber: i + 1,
            accountId: l.accountId,
            classId: l.classId,
            partyId: l.partyId,
            className: l.className,
            partyName: l.partyName,
            grantSide: l.grantSide,
            debitCents: l.debitCents,
            creditCents: l.creditCents,
            description: l.description,
          })),
        },
      },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    await recordAudit(tx, {
      orgId,
      entity: 'CorrectingEntryDraft',
      entityId: draft.id,
      action: 'create',
      after: { code, kind: input.kind, lines: draft.lines.length, memo },
      actor,
    });
    return draft;
  });
}

/**
 * D1-B reclass draft for the lines of one exclude decision group: per original
 * account, credit the grant and debit the default destination.
 */
export async function draftReclassForDecisionGroup(
  orgId: string,
  grantId: string,
  groupId: string,
  actor = 'local-user',
  /** Journal date carried by the export; defaults to today. */
  date: Date = new Date(),
) {
  const destination = await requireDestination(orgId);
  const grantSide = await grantDestination(orgId, grantId);
  const existing = await prisma.correctingEntryDraft.findFirst({
    where: { orgId, grantId, sourceDecisionGroupId: groupId, status: { not: 'void' } },
  });
  if (existing)
    throw new ValidationError({
      _: `Correcting entry ${existing.code} already covers this exclusion (${existing.status})`,
    });
  const decisions = await prisma.lineDecision.findMany({
    where: { orgId, grantId, groupId, kind: 'exclude' },
    include: {
      line: {
        select: {
          accountId: true,
          amountCents: true,
          account: { select: { name: true } },
          transaction: { select: { txnDate: true } },
        },
      },
    },
  });
  const excluded = decisions.flatMap((d) =>
    d.line
      ? [
          {
            accountId: d.line.accountId,
            accountName: d.line.account.name,
            txnDate: d.line.transaction.txnDate,
            amountCents: d.line.amountCents,
          },
        ]
      : [],
  );
  if (excluded.length === 0)
    throw new ValidationError({ _: 'No excluded lines found for this decision' });
  const grant = await prisma.grant.findFirstOrThrow({ where: { id: grantId } });
  const reason = decisions[0]?.reason ?? 'excluded';
  return saveDraft(
    orgId,
    {
      grantId,
      kind: 'reclass',
      date,
      memo: '',
      sourceDecisionGroupId: groupId,
      build: (code) => ({
        lines: buildReclassLines({ code, excluded, grant: grantSide, destination }),
        memo: `${code} reclass: ${excluded.length} line(s) excluded from ${grant.name} (${reason})`,
      }),
    },
    actor,
  );
}

/**
 * True-up draft for a schedule's current booked − charged variance on one
 * payroll account. Account rule (logged in QUESTIONS.md): the matched payroll
 * account carrying the most booked cents — for the pilot, Salaries.
 */
export async function draftTrueUpForSchedule(
  orgId: string,
  grantId: string,
  scheduleId: string,
  actor = 'local-user',
  /** Journal date carried by the export; defaults to today. */
  date: Date = new Date(),
) {
  const destination = await requireDestination(orgId);
  const grantSide = await grantDestination(orgId, grantId);
  // One open true-up per schedule: a second draft for the same variance would
  // post twice and over-correct the grant. Void the open one first.
  const open = await prisma.correctingEntryDraft.findFirst({
    where: { orgId, grantId, sourceScheduleId: scheduleId, kind: 'true_up', status: 'drafted' },
  });
  if (open)
    throw new ValidationError({
      _: `Correcting entry ${open.code} is already drafted for this schedule; void it before drafting another true-up`,
    });
  const summary = await effortSummary(orgId, grantId);
  const s = summary.schedules.find((x) => x.id === scheduleId);
  if (!s) throw new ValidationError({ _: 'Schedule not found' });
  if (s.varianceCents === 0) throw new ValidationError({ _: 'Variance is 0.00; nothing to true up' });
  const account = s.bookedAccounts[0];
  if (!account)
    throw new ValidationError({
      _: 'No booked payroll lines matched this schedule; nothing to true up against',
    });
  const grant = await prisma.grant.findFirstOrThrow({ where: { id: grantId } });
  return saveDraft(
    orgId,
    {
      grantId,
      kind: 'true_up',
      date,
      memo: '',
      sourceScheduleId: scheduleId,
      build: (code) => ({
        lines: buildTrueUpLines({
          code,
          varianceCents: s.varianceCents,
          accountId: account.accountId,
          accountName: account.accountName,
          personLabel: s.personLabel,
          grant: grantSide,
          destination,
        }),
        memo: `${code} true-up: ${s.personLabel} effort on ${grant.name}, booked − charged`,
      }),
    },
    actor,
  );
}

export async function voidDraft(
  orgId: string,
  grantId: string,
  draftId: string,
  note: string,
  actor = 'local-user',
) {
  const trimmed = note.trim();
  if (!trimmed) throw new ValidationError({ note: 'A note is required to void a draft' });
  const draft = await prisma.correctingEntryDraft.findFirst({
    where: { id: draftId, orgId, grantId },
  });
  if (!draft) throw new ValidationError({ _: 'Draft not found' });
  if (draft.status !== 'drafted')
    throw new ValidationError({ _: `Only drafted entries can be voided (this one is ${draft.status})` });
  return prisma.$transaction(async (tx) => {
    const row = await tx.correctingEntryDraft.update({
      where: { id: draftId },
      data: { status: 'void', voidedAt: new Date(), voidNote: trimmed },
    });
    await recordAudit(tx, {
      orgId,
      entity: 'CorrectingEntryDraft',
      entityId: draftId,
      action: 'update',
      before: { status: draft.status },
      after: { status: 'void', voidNote: trimmed },
      actor,
    });
    return row;
  });
}

export async function listDrafts(orgId: string, grantId: string) {
  const drafts = await prisma.correctingEntryDraft.findMany({
    where: { orgId, grantId },
    include: { lines: { orderBy: { lineNumber: 'asc' } } },
    orderBy: { code: 'asc' },
  });
  return drafts.map((d) => ({
    ...d,
    amountCents: d.lines.reduce((s, l) => s + l.debitCents, 0),
  }));
}

export async function getDraftByCode(orgId: string, grantId: string, code: string) {
  return prisma.correctingEntryDraft.findFirst({
    where: { orgId, grantId, code },
    include: {
      grant: { select: { name: true } },
      lines: { orderBy: { lineNumber: 'asc' }, include: { account: true } },
    },
  });
}

/** Names for class / party ids on the lines of one draft (export rendering). */
export async function draftLabels(orgId: string, lines: Array<{ classId: string | null; partyId: string | null }>) {
  const classIds = [...new Set(lines.map((l) => l.classId).filter((x): x is string => !!x))];
  const partyIds = [...new Set(lines.map((l) => l.partyId).filter((x): x is string => !!x))];
  const [classes, parties] = await Promise.all([
    classIds.length
      ? prisma.trackingClass.findMany({ where: { orgId, id: { in: classIds } } })
      : [],
    partyIds.length ? prisma.party.findMany({ where: { orgId, id: { in: partyIds } } }) : [],
  ]);
  return {
    className: new Map(classes.map((c) => [c.id, c.name])),
    partyName: new Map(parties.map((p) => [p.id, p.displayName])),
  };
}

/**
 * The journal lines that posted a draft code on a grant: member lines of
 * `JournalEntry` transactions where the transaction memo or the line's own
 * description carries the code. Report imports store every export row as its
 * own transaction, so one posted journal with n grant-side lines arrives as n
 * transactions — callers aggregate over all of them.
 */
async function postedJournalLines(db: Db, orgId: string, grantId: string, code: string) {
  const candidates = await db.transaction.findMany({
    where: {
      orgId,
      deletedAt: null,
      txnType: 'JournalEntry',
      lines: { some: { deletedAt: null, memberships: { some: { grantId, supersededAt: null } } } },
    },
    include: {
      lines: {
        where: { deletedAt: null, memberships: { some: { grantId, supersededAt: null } } },
        select: { id: true, amountCents: true, description: true, transactionId: true },
      },
    },
    orderBy: [{ txnDate: 'asc' }, { externalId: 'asc' }],
  });
  const out: Array<{ id: string; transactionId: string; amountCents: number }> = [];
  for (const t of candidates) {
    const memoCarries = carriesCode(t.memo, code);
    for (const l of t.lines) {
      if (memoCarries || carriesCode(l.description, code))
        out.push({ id: l.id, transactionId: t.id, amountCents: l.amountCents });
    }
  }
  return out;
}

/**
 * Marks drafted entries `posted` when the grant's member journal lines that
 * carry the draft code (memo or line description, across every row of the
 * posted journal) sum exactly to the draft's grant-side total. A total that
 * does not match — including a code posted twice — leaves the draft
 * `drafted` for a human to look at. Idempotent: posted / void drafts are never
 * touched. Runs after every import and at the start of recompute.
 */
export async function detectPostedEntries(
  db: Db,
  orgId: string,
  actor = 'system:posted-detection',
): Promise<Array<{ code: string; transactionId: string }>> {
  const drafts = await db.correctingEntryDraft.findMany({
    where: { orgId, status: 'drafted' },
    include: { lines: true },
  });
  if (drafts.length === 0) return [];
  const posted: Array<{ code: string; transactionId: string }> = [];
  for (const draft of drafts) {
    const journalLines = await postedJournalLines(db, orgId, draft.grantId, draft.code);
    if (journalLines.length === 0) continue;
    const expected = grantSideCents(draft.lines);
    const actual = journalLines.reduce((t, l) => t + l.amountCents, 0);
    if (actual !== expected) continue;
    const transactionId = journalLines[0]!.transactionId;
    await db.correctingEntryDraft.update({
      where: { id: draft.id },
      data: { status: 'posted', postedTransactionId: transactionId, postedAt: new Date() },
    });
    await recordAudit(db, {
      orgId,
      entity: 'CorrectingEntryDraft',
      entityId: draft.id,
      action: 'update',
      before: { status: 'drafted' },
      after: {
        status: 'posted',
        postedTransactionId: transactionId,
        postedLineIds: journalLines.map((l) => l.id),
        code: draft.code,
      },
      actor,
    });
    posted.push({ code: draft.code, transactionId });
  }
  if (posted.length > 0) await markCurrentRunStale(db, orgId);
  return posted;
}

/**
 * Grant-stage config: every member journal line that carries a posted draft's
 * code (all rows of the posted journal, not only the transaction recorded as
 * `postedTransactionId`).
 */
export async function loadPostedLines(orgId: string): Promise<GrantStagePostedLine[]> {
  const drafts = await prisma.correctingEntryDraft.findMany({
    where: { orgId, status: 'posted' },
    select: { grantId: true, code: true, postedTransactionId: true },
    orderBy: { code: 'asc' },
  });
  const out: GrantStagePostedLine[] = [];
  for (const d of drafts) {
    const lines = await postedJournalLines(prisma, orgId, d.grantId, d.code);
    const seen = new Set<string>();
    for (const l of lines) {
      seen.add(l.id);
      out.push({ grantId: d.grantId, lineId: l.id, code: d.code });
    }
    if (d.postedTransactionId) {
      const rest = await prisma.transactionLine.findMany({
        where: { orgId, deletedAt: null, transactionId: d.postedTransactionId },
        select: { id: true },
      });
      for (const l of rest)
        if (!seen.has(l.id)) out.push({ grantId: d.grantId, lineId: l.id, code: d.code });
    }
  }
  return out;
}
