'use server';

import { redirect } from 'next/navigation';
import { parse as parseCsv } from 'csv-parse/sync';
import { grantBuilderOptions } from '@/components/rule-builder/options';
import { describeValues } from '@/components/rule-builder/describe';
import { recalculateAfter } from '@/lib/after-mutation';
import { getOrgId } from '@/lib/org';
import { safeReturnPath } from '@/lib/return-path';
import { formDataReader, readRuleValues } from '@/lib/rule-form';
import { parseRuleForm } from '@/lib/rule-form-parse';
import { prisma } from '@/lib/db';
import { bool, list, redirectWithErrors, str, strOrNull, zodErrors } from '@/lib/forms';
import {
  activityInputSchema,
  addRevision,
  revisionInputSchema,
  upsertActivity,
} from '@/services/grant-budget';
import { createGrantRule, deactivateGrantRule, updateGrantRule } from '@/services/grant-rules';
import {
  clearAtRisk,
  recordDecision,
  REVERSAL_PAIR_REASON,
  revertDecision,
} from '@/services/line-decisions';
import { parseDateInput } from '@/domain/dates';
import { readTrackingFields } from '@/app/grants/tracking-form';
import { MoneyParseError, centsToDecimalString, parseMoneyToCents } from '@/domain/money';
import {
  budgetLineInputSchema,
  BudgetLineBatchError,
  createGrant,
  deleteBudgetLine,
  deleteOrArchiveGrant,
  grantInputSchema,
  importBudgetLines,
  saveBudgetLines,
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
    ...(await readTrackingFields(orgId, formData)),
    programs,
  };
  const parsed = grantInputSchema.safeParse(candidate);
  if (!parsed.success) Object.assign(errors, { ...zodErrors(parsed.error), ...errors });
  if (Object.keys(errors).length > 0) return { ok: false as const, errors };
  return { ok: true as const, data: parsed.success ? parsed.data : null! };
}

/** "Update count" on the tracking block: re-render the form with the posted values, no save. */
function recountRequested(formData: FormData) {
  return str(formData, 'intent') === 'recount';
}

export async function createGrantAction(formData: FormData): Promise<void> {
  const orgId = await getOrgId();
  if (recountRequested(formData)) redirectWithErrors('/grants/new?mode=form', {}, formData);
  const r = await parseGrant(orgId, formData);
  if (!r.ok) redirectWithErrors('/grants/new?mode=form', r.errors, formData);
  const g = await createGrant(orgId, r.data);
  await recalculateAfter(orgId, 'grant created');
  redirect(`/grants/${g.id}?saved=1`);
}

export async function updateGrantAction(id: string, formData: FormData): Promise<void> {
  const orgId = await getOrgId();
  if (recountRequested(formData)) redirectWithErrors(`/grants/${id}/edit`, {}, formData);
  const r = await parseGrant(orgId, formData);
  if (!r.ok) redirectWithErrors(`/grants/${id}/edit`, r.errors, formData);
  try {
    await updateGrant(orgId, id, r.data);
  } catch (e) {
    if (e instanceof ValidationError)
      redirectWithErrors(`/grants/${id}/edit`, e.fieldErrors, formData);
    throw e;
  }
  await recalculateAfter(orgId, 'grant updated');
  redirect(`/grants/${id}?saved=1`);
}

export async function deleteGrantAction(id: string): Promise<void> {
  const orgId = await getOrgId();
  const r = await deleteOrArchiveGrant(orgId, id);
  await recalculateAfter(orgId, r.archived ? 'grant archived' : 'grant deleted');
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
    releaseClass: strOrNull(formData, 'releaseClass') ?? 'direct',
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
  await recalculateAfter(orgId, 'budget line saved');
  redirect(`${back}?saved=1`);
}

const BATCH_FIELDS = [
  'code',
  'name',
  'budget',
  'budgetCents',
  'programId',
  'sortOrder',
  'kind',
  'parentId',
  'activityId',
  'categoryKey',
  'releaseClass',
] as const;

/**
 * One form saves every existing budget line (JPH-25 A9). Each row posts the same field names,
 * so the values are read as aligned columns keyed by the `$row` ids; only rows whose values
 * differ from the stored line are written. `budgetCents` (integer cents, filled in by the
 * client island) wins over the decimal `budget` text when present, so a JS-less post still
 * works and a JS post never re-parses a formatted number.
 */
export async function saveBudgetLinesAction(grantId: string, formData: FormData): Promise<void> {
  const back = `/grants/${grantId}/budget`;
  const ids = formData.getAll('$row').filter((v): v is string => typeof v === 'string');
  const columns = Object.fromEntries(
    BATCH_FIELDS.map((f) => [f, formData.getAll(f).map((v) => (typeof v === 'string' ? v : ''))]),
  ) as Record<(typeof BATCH_FIELDS)[number], string[]>;
  for (const f of BATCH_FIELDS)
    if (columns[f].length !== ids.length)
      throw new Error(
        `Budget line form posted ${columns[f].length} "${f}" values for ${ids.length} rows`,
      );

  const errors: Record<string, string> = {};
  const rows = ids.map((lineId, i) => {
    const fd = new FormData();
    for (const f of BATCH_FIELDS) fd.set(f, columns[f][i] ?? '');
    const cents = columns.budgetCents[i] ?? '';
    if (/^-?\d+$/.test(cents)) fd.set('budget', centsToDecimalString(Number(cents)));
    const r = parseBudgetLine(fd);
    if (!r.ok) for (const [k, v] of Object.entries(r.errors)) errors[`${lineId}.${k}`] = v;
    return { lineId, data: r.ok ? r.data : null };
  });
  if (Object.keys(errors).length > 0) redirectWithErrors(back, errors, formData);

  const orgId = await getOrgId();
  let saved = 0;
  try {
    // All rows commit together or not at all (one save, one transaction).
    ({ saved } = await saveBudgetLines(
      orgId,
      grantId,
      rows.map(({ lineId, data }) => ({ lineId, input: data! })),
    ));
  } catch (e) {
    if (e instanceof BudgetLineBatchError)
      redirectWithErrors(
        back,
        Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [`${e.lineId}.${k}`, v])),
        formData,
      );
    throw e;
  }
  await recalculateAfter(orgId, `budget lines saved (${saved})`);
  redirect(`${back}?saved=${saved}`);
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
  await recalculateAfter(orgId, 'budget line deleted');
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
  await recalculateAfter(orgId, 'budget lines imported');
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
  await recalculateAfter(orgId, 'budget activity saved');
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

async function saveGrantRule(
  grantId: string,
  ruleId: string | null,
  back: string,
  formData: FormData,
): Promise<void> {
  // JPH-27: the review queue's "Always do this" link asks to come back to the queue after Save;
  // the bounces below keep the parameter so a Preview or a validation error does not lose it.
  const returnTo = str(formData, 'returnTo') ? safeReturnPath(str(formData, 'returnTo'), '') : '';
  const bounce = (extra: Record<string, string> = {}) => {
    const q = new URLSearchParams({ ...extra, ...(returnTo ? { returnTo } : {}) }).toString();
    return q ? `${back}?${q}` : back;
  };
  // The no-JS Preview button bounces the form back and the page server-renders the preview.
  if (str(formData, 'intent') === 'preview')
    redirectWithErrors(bounce({ preview: '1' }), {}, formData);
  const orgId = await getOrgId();
  const [grant, options] = await Promise.all([
    prisma.grant.findFirst({ where: { id: grantId, orgId }, select: { name: true } }),
    grantBuilderOptions(orgId, grantId),
  ]);
  const reader = formDataReader(formData);
  const suggested = describeValues(
    readRuleValues(reader, 'grant'),
    'grant',
    options,
    grant?.name,
  ).suggestedName;
  const parsed = parseRuleForm(reader, 'grant', suggested);
  if (parsed.kind !== 'grant' || !parsed.data || Object.keys(parsed.errors).length)
    redirectWithErrors(bounce(), parsed.errors, formData);
  let id = ruleId;
  try {
    const rule = ruleId
      ? await updateGrantRule(orgId, grantId, ruleId, parsed.data)
      : await createGrantRule(orgId, grantId, parsed.data);
    id = rule.id;
  } catch (e) {
    if (e instanceof ValidationError) redirectWithErrors(bounce(), e.fieldErrors, formData);
    throw e;
  }
  await recalculateAfter(orgId, `grant rule ${ruleId ? 'updated' : 'created'}`);
  if (returnTo) {
    const sep = returnTo.includes('?') ? '&' : '?';
    redirect(`${returnTo}${sep}saved=1&rule=${id}`);
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
  await recalculateAfter(orgId, 'grant rule deactivated');
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
  await recalculateAfter(orgId, `review decision recorded (${kind})`);
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
        redirect(
          `${back}?saved=1&draftError=${encodeURIComponent(Object.values(e.fieldErrors).join('; '))}`,
        );
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
  await recalculateAfter(orgId, 'reversal pair confirmed');
  redirect(`${back}?saved=1`);
}

export async function revertDecisionAction(grantId: string, formData: FormData): Promise<void> {
  const orgId = await getOrgId();
  await revertDecision(orgId, grantId, list(formData, 'lineIds'));
  await recalculateAfter(orgId, 'review decision reverted');
  redirect(`/grants/${grantId}/review?saved=1`);
}

export async function clearAtRiskAction(grantId: string, formData: FormData): Promise<void> {
  const orgId = await getOrgId();
  await clearAtRisk(orgId, grantId, list(formData, 'lineIds'));
  await recalculateAfter(orgId, 'at-risk flag cleared');
  redirect(`/grants/${grantId}/review?saved=1`);
}
