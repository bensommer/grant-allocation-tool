'use server';

import { redirect } from 'next/navigation';
import { parse as parseCsv } from 'csv-parse/sync';
import { getOrgId } from '@/lib/org';
import { prisma } from '@/lib/db';
import { list, redirectWithErrors, str, strOrNull, zodErrors } from '@/lib/forms';
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
