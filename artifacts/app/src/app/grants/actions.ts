'use server';

import { redirect } from 'next/navigation';
import { parse as parseCsv } from 'csv-parse/sync';
import { getOrgId } from '@/lib/org';
import { prisma } from '@/lib/db';
import { bool, list, redirectWithErrors, str, strOrNull, zodErrors } from '@/lib/forms';
import {
  activityInputSchema,
  addRevision,
  revisionInputSchema,
  upsertActivity,
} from '@/services/grant-budget';
import {
  createGrantRule,
  deactivateGrantRule,
  grantRuleInputSchema,
  updateGrantRule,
} from '@/services/grant-rules';
import {
  clearAtRisk,
  recordDecision,
  REVERSAL_PAIR_REASON,
  revertDecision,
} from '@/services/line-decisions';
import { parseDateInput } from '@/domain/dates';
import { MoneyParseError, parseMoneyToCents } from '@/domain/money';
import {
  budgetLineInputSchema,
  createGrant,
  deleteBudgetLine,
  deleteOrArchiveGrant,
  grantInputSchema,
  importBudgetLines,
  updateGrant,
  upsertBudgetLine,
  type BudgetLineInput,
} from '@/services/grants';
import { ValidationError } from '@/services/programs';
import {
  DestinationUnsetError,
  GrantCodingUnsetError,
  draftReclassForDecisionGroup,
} from '@/services/correcting-entries';

function money(formData: FormData, name: string, errors: Record<string, string>): number {
  try {
    return parseMoneyToCents(str(formData, name));
  } catch (e) {
    errors[name] =
      e instanceof MoneyParseError ? 'Enter an amount like 1,234.56' : 'Invalid amount';
    return 0;
  }
}
function date(formData: FormData, name: string, errors: Record<string, string>): Date {
  try {
    return parseDateInput(str(formData, name));
  } catch {
    errors[name] = 'Enter a date as YYYY-MM-DD';
    return new Date(0);
  }
}

async function parseGrant(orgId: string, formData: FormData) {
  const errors: Record<string, string> = {};
  const funderPartyId = strOrNull(formData, 'funderPartyId');
  let funder = str(formData, 'funderText');
  if (funderPartyId) {
    const party = await prisma.party.findFirst({ where: { id: funderPartyId, orgId } });
    if (!party) errors['funderPartyId'] = 'Unknown funder';
    else funder = party.displayName;
  }
  const programIds = list(formData, 'programIds');
  const programs = programIds.map((programId) => {
    const raw = str(formData, `plannedShare_${programId}`);
    let plannedShareBps: number | null = null;
    if (raw !== '') {
      const n = Number(raw.replace('%', ''));
      if (!Number.isFinite(n) || n < 0 || n > 100)
        errors[`plannedShare_${programId}`] = 'Share must be 0–100';
      else plannedShareBps = Math.round(n * 100);
    }
    return { programId, plannedShareBps };
  });
  const candidate = {
    name: str(formData, 'name'),
    funder,
    funderPartyId,
    awardNumber: strOrNull(formData, 'awardNumber'),
    startDate: date(formData, 'startDate', errors),
    endDate: date(formData, 'endDate', errors),
    awardAmountCents: money(formData, 'awardAmount', errors),
    restrictionType: str(formData, 'restrictionType'),
    status: str(formData, 'status'),
    revenueAccountId: strOrNull(formData, 'revenueAccountId'),
    matchPartyIds: list(formData, 'matchPartyIds'),
    matchClassIds: list(formData, 'matchClassIds'),
    memberClassIds: list(formData, 'memberClassIds'),
    memberPartyIds: list(formData, 'memberPartyIds'),
    qboClassName: strOrNull(formData, 'qboClassName'),
    qboProjectName: strOrNull(formData, 'qboProjectName'),
    programs,
  };
  const parsed = grantInputSchema.safeParse(candidate);
  if (!parsed.success) Object.assign(errors, { ...zodErrors(parsed.error), ...errors });
  if (Object.keys(errors).length > 0) return { ok: false as const, errors };
  return { ok: true as const, data: parsed.success ? parsed.data : null! };
}

export async function createGrantAction(formData: FormData): Promise<void> {
  const orgId = await getOrgId();
  const r = await parseGrant(orgId, formData);
  if (!r.ok) redirectWithErrors('/grants/new', r.errors, formData);
  const g = await createGrant(orgId, r.data);
  redirect(`/grants/${g.id}?saved=1`);
}

export async function updateGrantAction(id: string, formData: FormData): Promise<void> {
  const orgId = await getOrgId();
  const r = await parseGrant(orgId, formData);
  if (!r.ok) redirectWithErrors(`/grants/${id}/edit`, r.errors, formData);
  try {
    await updateGrant(orgId, id, r.data);
  } catch (e) {
    if (e instanceof ValidationError)
      redirectWithErrors(`/grants/${id}/edit`, e.fieldErrors, formData);
    throw e;
  }
  redirect(`/grants/${id}?saved=1`);
}

export async function deleteGrantAction(id: string): Promise<void> {
  const orgId = await getOrgId();
  const r = await deleteOrArchiveGrant(orgId, id);
  redirect(r.archived ? `/grants/${id}?archived=1` : '/grants?deleted=1');
}

function parseBudgetLine(formData: FormData) {
  const errors: Record<string, string> = {};
  const candidate = {
    code: str(formData, 'code').toUpperCase(),
    name: str(formData, 'name'),
    budgetCents: money(formData, 'budget', errors),
    programId: strOrNull(formData, 'programId'),
    sortOrder: Number(str(formData, 'sortOrder') || '0'),
    // JPH-21 two-level budgets; absent fields keep the flat (phase-1) shape.
    kind: (str(formData, 'kind') || 'working_line') as BudgetLineInput['kind'],
    parentId: strOrNull(formData, 'parentId'),
    activityId: strOrNull(formData, 'activityId'),
    categoryKey: strOrNull(formData, 'categoryKey'),
  };
  const parsed = budgetLineInputSchema.safeParse(candidate);
  if (!parsed.success) Object.assign(errors, { ...zodErrors(parsed.error), ...errors });
  if (Object.keys(errors).length > 0) return { ok: false as const, errors };
  return { ok: true as const, data: parsed.data! };
}

export async function saveBudgetLineAction(
  grantId: string,
  lineId: string | null,
  formData: FormData,
): Promise<void> {
  const back = `/grants/${grantId}/budget`;
  const r = parseBudgetLine(formData);
  const prefix = lineId ? `${lineId}.` : '';
  if (!r.ok)
    redirectWithErrors(
      back,
      Object.fromEntries(Object.entries(r.errors).map(([k, v]) => [prefix + k, v])),
      formData,
    );
  const orgId = await getOrgId();
  try {
    await upsertBudgetLine(orgId, grantId, r.data, lineId ?? undefined);
  } catch (e) {
    if (e instanceof ValidationError)
      redirectWithErrors(
        back,
        Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [prefix + k, v])),
        formData,
      );
    throw e;
  }
  redirect(`${back}?saved=1`);
}

export async function deleteBudgetLineAction(grantId: string, lineId: string): Promise<void> {
  const orgId = await getOrgId();
  try {
    await deleteBudgetLine(orgId, grantId, lineId);
  } catch (e) {
    if (e instanceof ValidationError)
      redirectWithErrors(`/grants/${grantId}/budget`, e.fieldErrors, new FormData());
    throw e;
  }
  redirect(`/grants/${grantId}/budget?saved=1`);
}

/** Paste or upload CSV: code,name,budget,program_code */
export async function importBudgetLinesAction(grantId: string, formData: FormData): Promise<void> {
  const back = `/grants/${grantId}/budget/import`;
  const file = formData.get('file');
  let text = str(formData, 'csv');
  if (file instanceof File && file.size > 0)
    text = Buffer.from(await file.arrayBuffer()).toString('utf8');
  if (!text) redirectWithErrors(back, { csv: 'Paste CSV text or choose a file' }, formData);
  let records: Array<Record<string, string>>;
  try {
    records = parseCsv(text, {
      bom: true,
      columns: (h: string[]) => h.map((c) => c.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  } catch (e) {
    redirectWithErrors(back, { csv: `Could not parse CSV: ${(e as Error).message}` }, formData);
  }
  const orgId = await getOrgId();
  const programs = await prisma.program.findMany({
    where: { orgId },
    select: { id: true, code: true },
  });
  const programByCode = new Map(programs.map((p) => [p.code.toUpperCase(), p.id]));
  const rows: BudgetLineInput[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  records!.forEach((rec, i) => {
    const rowNo = i + 2;
    const errors: Record<string, string> = {};
    let budgetCents = 0;
    try {
      budgetCents = parseMoneyToCents(rec['budget'] ?? '');
    } catch {
      errors['budget'] = `bad amount "${rec['budget']}"`;
    }
    const programCode = (rec['program_code'] ?? '').trim().toUpperCase();
    const programId = programCode ? (programByCode.get(programCode) ?? null) : null;
    if (programCode && !programId) errors['program_code'] = `unknown program "${programCode}"`;
    const parsed = budgetLineInputSchema.safeParse({
      code: (rec['code'] ?? '').trim().toUpperCase(),
      name: (rec['name'] ?? '').trim(),
      budgetCents,
      programId,
      sortOrder: rows.length + 1,
    });
    if (!parsed.success) Object.assign(errors, zodErrors(parsed.error));
    if (parsed.success && seen.has(parsed.data.code))
      errors['code'] = `duplicate code ${parsed.data.code}`;
    if (Object.keys(errors).length > 0) {
      problems.push(`Row ${rowNo}: ${Object.values(errors).join('; ')}`);
      return;
    }
    seen.add(parsed.data!.code);
    rows.push(parsed.data!);
  });
  if (problems.length > 0) redirectWithErrors(back, { csv: problems.join('\n') }, formData);
  if (rows.length === 0)
    redirectWithErrors(
      back,
      { csv: 'No rows found. Expected header: code,name,budget,program_code' },
      formData,
    );
  const result = await importBudgetLines(orgId, grantId, rows);
  redirect(`/grants/${grantId}/budget?imported=${result.created}&updated=${result.updated}`);
}

// --- JPH-21: activities, revisions, grant rules, decisions ---------------------

export async function saveActivityAction(
  grantId: string,
  activityId: string | null,
  formData: FormData,
): Promise<void> {
  const back = `/grants/${grantId}/budget`;
  const prefix = activityId ? `activity.${activityId}.` : 'activity.';
  const parsed = activityInputSchema.safeParse({
    name: str(formData, 'name'),
    aliases: str(formData, 'aliases')
      .split(/[,;\n]/)
      .map((a) => a.trim())
      .filter((a) => a !== ''),
    plannedCount: Number(str(formData, 'plannedCount') || '0'),
    completedCount: Number(str(formData, 'completedCount') || '0'),
    sortOrder: Number(str(formData, 'sortOrder') || '0'),
  });
  const prefixed = (errors: Record<string, string>) =>
    Object.fromEntries(Object.entries(errors).map(([k, v]) => [prefix + k, v]));
  if (!parsed.success) redirectWithErrors(back, prefixed(zodErrors(parsed.error)), formData);
  const orgId = await getOrgId();
  try {
    await upsertActivity(orgId, grantId, parsed.data, activityId ?? undefined);
  } catch (e) {
    if (e instanceof ValidationError) redirectWithErrors(back, prefixed(e.fieldErrors), formData);
    throw e;
  }
  redirect(`${back}?saved=1#activities`);
}

export async function addRevisionAction(grantId: string, formData: FormData): Promise<void> {
  const back = `/grants/${grantId}/budget`;
  const errors: Record<string, string> = {};
  const deltaCents = money(formData, 'delta', errors);
  const parsed = revisionInputSchema.safeParse({
    budgetLineId: str(formData, 'budgetLineId'),
    date: date(formData, 'date', errors),
    deltaCents,
    counterpartLineId: strOrNull(formData, 'counterpartLineId'),
    note: str(formData, 'note'),
  });
  if (!parsed.success) Object.assign(errors, { ...zodErrors(parsed.error), ...errors });
  const prefixed = (errs: Record<string, string>) =>
    Object.fromEntries(Object.entries(errs).map(([k, v]) => [`revision.${k}`, v]));
  if (Object.keys(errors).length > 0) redirectWithErrors(back, prefixed(errors), formData);
  const orgId = await getOrgId();
  try {
    await addRevision(orgId, grantId, parsed.data!);
  } catch (e) {
    if (e instanceof ValidationError) redirectWithErrors(back, prefixed(e.fieldErrors), formData);
    throw e;
  }
  redirect(`${back}?saved=1#revisions`);
}

function parseGrantRule(formData: FormData) {
  const dimension = str(formData, 'dimension') || 'line';
  const matchers = {
    accountIds: list(formData, 'accountIds'),
    classIds: list(formData, 'classIds'),
    partyIds: list(formData, 'partyIds'),
    descriptionContains: str(formData, 'descriptionContains'),
    descriptionContainsAny: str(formData, 'descriptionContainsAny')
      .split(/[,;\n]/)
      .map((a) => a.trim())
      .filter((a) => a !== ''),
    txnTypes: list(formData, 'txnTypes'),
    ...(str(formData, 'amountSign') ? { amountSign: str(formData, 'amountSign') } : {}),
    ...(str(formData, 'dateFrom') ? { dateFrom: str(formData, 'dateFrom') } : {}),
    ...(str(formData, 'dateTo') ? { dateTo: str(formData, 'dateTo') } : {}),
  };
  const result = grantRuleInputSchema.safeParse({
    name: str(formData, 'name'),
    dimension,
    grantBudgetLineId: dimension === 'line' ? strOrNull(formData, 'grantBudgetLineId') : null,
    targetActivityId: dimension === 'activity' ? strOrNull(formData, 'targetActivityId') : null,
    targetCategoryKey: dimension === 'category' ? strOrNull(formData, 'targetCategoryKey') : null,
    priority: Number(str(formData, 'priority')),
    active: bool(formData, 'active'),
    matchers,
  });
  const errors = result.success ? {} : zodErrors(result.error);
  if (matchers.dateFrom && matchers.dateTo && matchers.dateFrom > matchers.dateTo)
    errors['matchers.dateTo'] = 'End date must be on or after start';
  return { data: result.success ? result.data : null, errors };
}

async function saveGrantRule(
  grantId: string,
  ruleId: string | null,
  back: string,
  formData: FormData,
): Promise<void> {
  // Preview follows the crosswalk pattern: bounce the form state back with ?preview=1.
  if (str(formData, 'intent') === 'preview') redirectWithErrors(`${back}?preview=1`, {}, formData);
  const parsed = parseGrantRule(formData);
  if (!parsed.data || Object.keys(parsed.errors).length)
    redirectWithErrors(back, parsed.errors, formData);
  const orgId = await getOrgId();
  let id = ruleId;
  try {
    const rule = ruleId
      ? await updateGrantRule(orgId, grantId, ruleId, parsed.data)
      : await createGrantRule(orgId, grantId, parsed.data);
    id = rule.id;
  } catch (e) {
    if (e instanceof ValidationError) redirectWithErrors(back, e.fieldErrors, formData);
    throw e;
  }
  redirect(`/grants/${grantId}/rules/${id}?saved=1`);
}

export async function createGrantRuleAction(grantId: string, formData: FormData): Promise<void> {
  await saveGrantRule(grantId, null, `/grants/${grantId}/rules/new`, formData);
}
export async function updateGrantRuleAction(
  grantId: string,
  ruleId: string,
  formData: FormData,
): Promise<void> {
  await saveGrantRule(grantId, ruleId, `/grants/${grantId}/rules/${ruleId}`, formData);
}
export async function deactivateGrantRuleAction(grantId: string, ruleId: string): Promise<void> {
  const orgId = await getOrgId();
  await deactivateGrantRule(orgId, grantId, ruleId);
  redirect(`/grants/${grantId}/rules?deactivated=1`);
}

/** Review queue decision form: assign / exclude / at_risk over the checked lines. */
export async function recordDecisionAction(grantId: string, formData: FormData): Promise<void> {
  const back = `/grants/${grantId}/review`;
  const kind = str(formData, 'kind');
  const lineIds = list(formData, 'lineIds');
  const note = str(formData, 'note');
  const reason = str(formData, 'reason');
  const errors: Record<string, string> = {};
  if (lineIds.length === 0) errors['lineIds'] = 'Select at least one line';
  if (!['assign', 'exclude', 'at_risk'].includes(kind)) errors['kind'] = 'Choose a decision';
  if (kind === 'assign' && !str(formData, 'targetBudgetLineId'))
    errors['targetBudgetLineId'] = 'Select a working line or cell';
  if (kind === 'exclude' && !reason) errors['reason'] = 'A reason is required to exclude';
  if (!note) errors['note'] = 'A note is required';
  if (Object.keys(errors).length > 0) redirectWithErrors(back, errors, formData);
  const orgId = await getOrgId();
  let groupId: string;
  try {
    ({ groupId } = await recordDecision(orgId, grantId, {
      kind: kind as 'assign' | 'exclude' | 'at_risk',
      lineIds,
      targetBudgetLineId: kind === 'assign' ? str(formData, 'targetBudgetLineId') : null,
      reason: reason || null,
      note,
    }));
  } catch (e) {
    if (e instanceof ValidationError) redirectWithErrors(back, e.fieldErrors, formData);
    throw e;
  }
  // "Draft correcting entry" (JPH-22): an exclusion may draft the D1-B reclass in the same
  // action. The exclusion is already saved; a blocked draft only reports why.
  if (kind === 'exclude' && bool(formData, 'draftEntry')) {
    try {
      const draft = await draftReclassForDecisionGroup(orgId, grantId, groupId);
      redirect(`${back}?saved=1&drafted=${encodeURIComponent(draft.code)}`);
    } catch (e) {
      if (e instanceof DestinationUnsetError) redirect(`${back}?saved=1&blocked=1`);
      if (e instanceof GrantCodingUnsetError) redirect(`${back}?saved=1&blocked=grant`);
      if (e instanceof ValidationError)
        redirect(`${back}?saved=1&draftError=${encodeURIComponent(Object.values(e.fieldErrors).join('; '))}`);
      throw e;
    }
  }
  redirect(`${back}?saved=1`);
}

/** Confirms a proposed reversal pair (two lines netting to zero). */
export async function confirmReversalPairAction(
  grantId: string,
  formData: FormData,
): Promise<void> {
  const back = `/grants/${grantId}/review`;
  const positiveId = str(formData, 'positiveId');
  const negativeId = str(formData, 'negativeId');
  const orgId = await getOrgId();
  try {
    await recordDecision(orgId, grantId, {
      kind: 'reversal_pair',
      lineIds: [positiveId, negativeId],
      targetBudgetLineId: null,
      reason: REVERSAL_PAIR_REASON,
      note: str(formData, 'note') || 'Confirmed reversal pair from the review queue',
    });
  } catch (e) {
    if (e instanceof ValidationError) redirectWithErrors(back, e.fieldErrors, formData);
    throw e;
  }
  redirect(`${back}?saved=1`);
}

export async function revertDecisionAction(grantId: string, formData: FormData): Promise<void> {
  const orgId = await getOrgId();
  await revertDecision(orgId, grantId, list(formData, 'lineIds'));
  redirect(`/grants/${grantId}/review?saved=1`);
}

export async function clearAtRiskAction(grantId: string, formData: FormData): Promise<void> {
  const orgId = await getOrgId();
  await clearAtRisk(orgId, grantId, list(formData, 'lineIds'));
  redirect(`/grants/${grantId}/review?saved=1`);
}
