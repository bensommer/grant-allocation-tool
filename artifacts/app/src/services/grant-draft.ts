/**
 * First-grant setup wizard state (JPH-29 E4): one GrantDraft row per browser, keyed by the
 * `grant_draft` cookie. Steps post their values here; Finish turns the draft into a grant, its
 * budget lines and starting rules in one transaction, then Phase D recomputes.
 */
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import {
  emptyDraft,
  incomeSelections,
  parseAward,
  parseBudget,
  parseDraftData,
  parseLines,
  linesFromCategories,
  ruleChoices,
  ruleRowKey,
  type DraftCategory,
  type DraftData,
  type DraftLine,
  type StepValues,
  type WizardStep,
} from '@/domain/grant-draft';
import { suggestFor, type SuggestContext, type SuggestLine } from '@/domain/suggest';
import type { TrackingFields } from '@/domain/tracking-choice';
import {
  budgetLineInputSchema,
  createGrant,
  grantInputSchema,
  upsertBudgetLine,
  type BudgetLineInput,
} from '@/services/grants';
import { createGrantRule } from '@/services/grant-rules';

export const DRAFT_COOKIE = 'grant_draft';

export interface Draft {
  id: string;
  orgId: string;
  token: string;
  step: WizardStep;
  data: DraftData;
}

function toDraft(row: {
  id: string;
  orgId: string;
  token: string;
  step: number;
  data: Prisma.JsonValue;
}): Draft {
  return {
    id: row.id,
    orgId: row.orgId,
    token: row.token,
    step: Math.min(5, Math.max(1, row.step)) as WizardStep,
    data: parseDraftData(row.data),
  };
}

/** The browser's draft, if the cookie names one that still exists. */
export async function loadDraft(orgId: string): Promise<Draft | null> {
  const token = (await cookies()).get(DRAFT_COOKIE)?.value;
  if (!token) return null;
  const row = await prisma.grantDraft.findFirst({ where: { token, orgId, grantId: null } });
  return row ? toDraft(row) : null;
}

/** The browser's draft, created (and the cookie set) if there is none. Server actions only. */
export async function ensureDraft(orgId: string): Promise<Draft> {
  const existing = await loadDraft(orgId);
  if (existing) return existing;
  const token = randomBytes(18).toString('base64url');
  const row = await prisma.grantDraft.create({ data: { orgId, token, data: emptyDraft() } });
  (await cookies()).set(DRAFT_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return toDraft(row);
}

/** Store one step's posted values (and, for step 2, the resolved tracking fields). */
export async function saveStep(
  draft: Draft,
  step: WizardStep,
  values: StepValues,
  opts: { resumeAt?: WizardStep; tracking?: TrackingFields } = {},
): Promise<Draft> {
  const data: DraftData = {
    ...draft.data,
    values: { ...draft.data.values, [String(step)]: values },
    tracking: opts.tracking ?? draft.data.tracking,
  };
  const row = await prisma.grantDraft.update({
    where: { id: draft.id },
    data: { data, step: opts.resumeAt ?? draft.step },
  });
  return toDraft(row);
}

export const stepValues = (draft: Draft | null, step: WizardStep): StepValues =>
  draft?.data.values[String(step)] ?? {};

/** The typed data the later steps depend on; null where an earlier step is not valid yet. */
export function draftCategories(draft: Draft | null): DraftCategory[] | null {
  const r = parseBudget(stepValues(draft, 3));
  return r.ok ? r.data : null;
}

export function draftLines(draft: Draft | null): DraftLine[] | null {
  const categories = draftCategories(draft);
  if (!categories) return null;
  const v = stepValues(draft, 4);
  if (v['hasLines'] !== 'yes') return linesFromCategories(categories);
  const r = parseLines(v, categories);
  return r.ok ? r.data : null;
}

// --- step 5: proposed rules ---------------------------------------------------------------

export interface ProposedRow {
  key: string;
  accountId: string;
  accountName: string;
  partyId: string | null;
  partyName: string | null;
  count: number;
  totalCents: number;
  /** Line code pre-selected by the suggestion engine (confidence 'account'), else null. */
  preselect: string | null;
  /** Why the engine pre-selected (or did not). */
  reason: string;
}

/**
 * The transactions step 2's choice marks (a class, or a customer / project), grouped: one row
 * per account with a nonzero total, sorted by amount descending, plus one row per name with
 * at least three transactions under that account. Pre-selection asks Phase C's engine; a new
 * grant has no rules yet, so only an account it already knows returns confidence 'account'.
 * Expense-type accounts only (the same set grant figures count as spending).
 */
export async function proposedRules(
  orgId: string,
  tracking: TrackingFields | null,
  lines: DraftLine[],
): Promise<ProposedRow[]> {
  if (!tracking) return [];
  const ors: Prisma.TransactionLineWhereInput[] = [];
  if (tracking.memberClassIds.length) ors.push({ classId: { in: tracking.memberClassIds } });
  if (tracking.memberPartyIds.length)
    ors.push(
      { partyId: { in: tracking.memberPartyIds } },
      { transaction: { partyId: { in: tracking.memberPartyIds } } },
    );
  if (ors.length === 0) return [];
  const txns = await prisma.transactionLine.findMany({
    where: {
      orgId,
      deletedAt: null,
      transaction: { deletedAt: null },
      // Spending only: income lines are receipts, never sent to a working line.
      account: { type: { in: ['Expense', 'COGS', 'OtherExpense'] } },
      OR: ors,
    },
    select: {
      id: true,
      accountId: true,
      partyId: true,
      classId: true,
      locationId: true,
      description: true,
      amountCents: true,
      account: { select: { name: true, number: true } },
      party: { select: { displayName: true } },
      transaction: {
        select: {
          partyId: true,
          txnDate: true,
          txnType: true,
          memo: true,
          party: { select: { displayName: true } },
        },
      },
    },
  });
  interface Acc {
    accountId: string;
    accountName: string;
    count: number;
    totalCents: number;
    sample: (typeof txns)[number];
    names: Map<string, { partyId: string; partyName: string; count: number; totalCents: number }>;
  }
  const byAccount = new Map<string, Acc>();
  for (const t of txns) {
    let acc = byAccount.get(t.accountId);
    if (!acc) {
      acc = {
        accountId: t.accountId,
        accountName: t.account.name,
        count: 0,
        totalCents: 0,
        sample: t,
        names: new Map(),
      };
      byAccount.set(t.accountId, acc);
    }
    acc.count++;
    acc.totalCents += t.amountCents;
    const partyId = t.partyId ?? t.transaction.partyId;
    const partyName = t.party?.displayName ?? t.transaction.party?.displayName ?? null;
    if (partyId && partyName) {
      const n = acc.names.get(partyId) ?? { partyId, partyName, count: 0, totalCents: 0 };
      n.count++;
      n.totalCents += t.amountCents;
      acc.names.set(partyId, n);
    }
  }
  const ctx: SuggestContext = {
    rules: [], // a grant being set up has no rules yet
    budgetLines: lines.map((l) => ({
      id: l.code,
      kind: 'working_line',
      activityId: null,
      categoryKey: null,
    })),
    assigned: [],
    labels: {
      budgetLine: (id) => lines.find((l) => l.code === id)?.name ?? id,
      activity: (id) => id,
      category: (k) => k,
      account: (id) => byAccount.get(id)?.accountName ?? id,
      party: (id) => id,
    },
  };
  const out: ProposedRow[] = [];
  const accounts = [...byAccount.values()]
    .filter((a) => a.totalCents !== 0)
    .sort(
      (a, b) =>
        Math.abs(b.totalCents) - Math.abs(a.totalCents) ||
        a.accountName.localeCompare(b.accountName),
    );
  for (const a of accounts) {
    const line: SuggestLine = {
      id: a.sample.id,
      accountId: a.accountId,
      accountNumber: a.sample.account.number,
      memo: a.sample.transaction.memo,
      partyId: a.sample.partyId,
      txnPartyId: a.sample.transaction.partyId,
      classId: a.sample.classId,
      locationId: a.sample.locationId,
      programId: null,
      description: a.sample.description,
      txnType: a.sample.transaction.txnType,
      txnDate: a.sample.transaction.txnDate,
      amountCents: a.sample.amountCents,
      reason: null,
      activityId: null,
      categoryRuleId: null,
    };
    const s = suggestFor(line, ctx);
    const preselect = s.confidence === 'account' ? (s.targetBudgetLineId ?? null) : null;
    out.push({
      key: ruleRowKey({ accountId: a.accountId, partyId: null }),
      accountId: a.accountId,
      accountName: a.accountName,
      partyId: null,
      partyName: null,
      count: a.count,
      totalCents: a.totalCents,
      preselect,
      reason: s.reason,
    });
    const names = [...a.names.values()]
      .filter((n) => n.count >= 3)
      .sort((x, y) => Math.abs(y.totalCents) - Math.abs(x.totalCents));
    for (const n of names)
      out.push({
        key: ruleRowKey({ accountId: a.accountId, partyId: n.partyId }),
        accountId: a.accountId,
        accountName: a.accountName,
        partyId: n.partyId,
        partyName: n.partyName,
        count: n.count,
        totalCents: n.totalCents,
        preselect,
        reason: s.reason,
      });
  }
  return out;
}

// --- finish -------------------------------------------------------------------------------

export class DraftIncompleteError extends Error {
  constructor(
    public step: WizardStep,
    detail?: string,
  ) {
    super(detail ? `Step ${step}: ${detail}` : `Step ${step} is not complete`);
  }
}

/**
 * Finish: the grant, its funder categories and working lines, and the chosen starting rules
 * are written in one transaction, so a failure half-way leaves nothing behind and Finish can
 * simply be pressed again. Everything is validated against the persisted schemas first; a
 * problem is reported on the step that owns it rather than surfacing as a 500.
 */
export async function finishDraft(
  orgId: string,
  draft: Draft,
  rows: ProposedRow[],
  step5: StepValues,
): Promise<string> {
  const award = parseAward(stepValues(draft, 1));
  if (!award.ok) throw new DraftIncompleteError(1);
  const tracking = draft.data.tracking;
  if (!tracking) throw new DraftIncompleteError(2);
  const categories = draftCategories(draft);
  if (!categories) throw new DraftIncompleteError(3);
  const lines = draftLines(draft);
  if (!lines) throw new DraftIncompleteError(4);
  const funderParty = await prisma.party.findFirst({
    where: { orgId, kind: 'customer', deletedAt: null, displayName: award.data.funderText },
    select: { id: true, displayName: true },
  });
  const income = incomeSelections(stepValues(draft, 2), funderParty?.id ?? null);
  const grantInput = grantInputSchema.safeParse({
    name: award.data.name,
    funder: funderParty?.displayName ?? award.data.funderText,
    funderPartyId: funderParty?.id ?? null,
    awardNumber: award.data.awardNumber,
    startDate: award.data.startDate,
    endDate: award.data.endDate,
    awardAmountCents: award.data.awardAmountCents,
    restrictionType: award.data.restrictionType,
    status: 'active',
    revenueAccountId: null,
    ...income,
    ...tracking,
    programs: [],
  });
  if (!grantInput.success) throw new DraftIncompleteError(1, firstIssue(grantInput.error));
  const categoryInputs: BudgetLineInput[] = categories.map((c, i) => ({
    code: c.code,
    name: c.name,
    budgetCents: c.budgetCents,
    programId: null,
    sortOrder: (i + 1) * 10,
    kind: 'funder_category',
    parentId: null,
  }));
  const lineInputs: BudgetLineInput[] = lines.map((l, i) => ({
    code: l.code,
    name: l.name,
    budgetCents: l.budgetCents,
    programId: null,
    sortOrder: (l.category + 1) * 10 + i + 1,
    kind: 'working_line',
    parentId: null,
  }));
  for (const [step, inputs] of [
    [3, categoryInputs],
    [4, lineInputs],
  ] as const) {
    for (const input of inputs) {
      const parsed = budgetLineInputSchema.safeParse(input);
      if (!parsed.success)
        throw new DraftIncompleteError(step, `${input.name}: ${firstIssue(parsed.error)}`);
    }
  }
  const choices = ruleChoices(step5);

  const grantId = await prisma.$transaction(
    async (tx) => {
      const grant = await createGrant(orgId, grantInput.data, tx);
      const categoryIds: string[] = [];
      for (const input of categoryInputs) {
        const row = await upsertBudgetLine(orgId, grant.id, input, undefined, tx);
        categoryIds.push(row.id);
      }
      const lineIdByCode = new Map<string, string>();
      for (const [i, input] of lineInputs.entries()) {
        const row = await upsertBudgetLine(
          orgId,
          grant.id,
          { ...input, parentId: categoryIds[lines[i]!.category] ?? null },
          undefined,
          tx,
        );
        lineIdByCode.set(input.code, row.id);
      }
      let priority = 10;
      for (const r of rows) {
        const code = choices.get(r.key);
        if (!code || code === 'later') continue;
        const lineId = lineIdByCode.get(code);
        if (!lineId) continue;
        await createGrantRule(
          orgId,
          grant.id,
          {
            name: r.partyName ? `${r.partyName} (${r.accountName})` : r.accountName,
            dimension: 'line',
            grantBudgetLineId: lineId,
            targetActivityId: null,
            targetCategoryKey: null,
            priority,
            active: true,
            matchers: r.partyId
              ? { accountIds: [r.accountId], partyIds: [r.partyId] }
              : { accountIds: [r.accountId] },
          },
          tx,
        );
        priority += 10;
      }
      await tx.grantDraft.delete({ where: { id: draft.id } });
      return grant.id;
    },
    { timeout: 60_000 },
  );
  return grantId;
}

function firstIssue(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  const issue = error.issues[0];
  return issue ? `${issue.path.join('.')} ${issue.message}`.trim() : 'Invalid value';
}

export async function clearDraftCookie() {
  (await cookies()).delete(DRAFT_COOKIE);
}
