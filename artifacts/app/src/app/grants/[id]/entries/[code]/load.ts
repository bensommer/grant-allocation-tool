import { getOrgId } from '@/lib/org';
import { draftLabels, getDraftByCode } from '@/services/correcting-entries';
import type { EntryExport } from '@/reports/correcting-entry';

/** Loads one draft as an export view, or null when the code is unknown for this grant. */
export async function loadEntryExport(grantId: string, code: string): Promise<EntryExport | null> {
  const orgId = await getOrgId();
  const draft = await getDraftByCode(orgId, grantId, code);
  if (!draft) return null;
  const labels = await draftLabels(orgId, draft.lines);
  return {
    code: draft.code,
    kind: draft.kind,
    status: draft.status,
    date: draft.date,
    memo: draft.memo,
    grantName: draft.grant.name,
    lines: draft.lines.map((l) => ({
      lineNumber: l.lineNumber,
      accountName: l.account.name,
      className: l.className ?? (l.classId ? (labels.className.get(l.classId) ?? null) : null),
      partyName: l.partyName ?? (l.partyId ? (labels.partyName.get(l.partyId) ?? null) : null),
      grantSide: l.grantSide,
      debitCents: l.debitCents,
      creditCents: l.creditCents,
      description: l.description,
    })),
  };
}
