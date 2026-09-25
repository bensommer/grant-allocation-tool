import { toISODate } from '@/domain/dates';
import { formatMoney } from '@/domain/format';
import { RELEASE_CLASSES, RELEASE_CLASS_LABEL } from '@/domain/periods';
import { getOrgId } from '@/lib/org';
import { pdfDocument, pdfErrorResponse, pdfResponse } from '@/reports/pdf';
import type { TableCell } from '@/reports/table-export';
import { rollforward, type RollforwardRow } from '@/services/grant-periods';
import { rollforwardNotes } from '@/services/grant-workspace';
import { RANGE_PRESET_LABEL, resolveRange } from '../range';

/** Print layout of the rollforward: the same grid as the page, zeros as 0.00, notes below. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const orgId = await getOrgId();
  const { from, to, preset, error } = await resolveRange(orgId, {
    range: sp.get('range') ?? undefined,
    from: sp.get('from') ?? undefined,
    to: sp.get('to') ?? undefined,
  });
  if (error) return new Response(error, { status: 400 });
  const rf = await rollforward(orgId, from, to);
  const money = (cents: number) => formatMoney(cents, { zero: 'zero' });
  const released = (r: { released: RollforwardRow['released'] }) =>
    r.released.direct + r.released.staff + r.released.overhead;
  const line = (label: string, pick: (r: RollforwardRow) => number, total: number): TableCell[] => [
    label,
    ...rf.rows.map((r) => money(pick(r))),
    money(total),
  ];
  const rows: TableCell[][] = [
    line('Beginning restricted balance', (r) => r.beginningCents, rf.totals.beginningCents),
    line('Received', (r) => r.receivedCents, rf.totals.receivedCents),
    ...RELEASE_CLASSES.map((cls) =>
      line(`Released — ${RELEASE_CLASS_LABEL[cls].toLowerCase()}`, (r) => r.released[cls], rf.totals.released[cls]),
    ),
    line('Ending restricted balance', (r) => r.endingCents, rf.totals.endingCents),
    line(
      'Check',
      (r) => r.beginningCents + r.receivedCents - released(r) - r.endingCents,
      rf.totals.checkCents,
    ),
  ];
  const notes: string[] = [];
  for (const r of rf.rows) {
    for (const p of r.priorPeriods)
      notes.push(`${r.name}: beginning balance from ${p.name} (${p.source === 'reported' ? 'reported' : 'computed at lock'}).`);
    for (const n of await rollforwardNotes(orgId, r.grantId)) notes.push(`${r.name}: ${n.text}`);
  }
  try {
    const buf = await pdfDocument({
      title: 'Restricted grants rollforward',
      subtitle: `${RANGE_PRESET_LABEL[preset]} · ${toISODate(from)} to ${toISODate(to)}`,
      parameters: { From: toISODate(from), To: toISODate(to), 'Compute run': rf.runId ?? 'none' },
      sections: [
        {
          table: {
            title: 'Rollforward',
            parameters: {},
            headers: ['Line', ...rf.rows.map((r) => r.name), 'Total'],
            rows,
            colAlign: ['left', ...rf.rows.map(() => 'right' as const), 'right'],
            rowKinds: rows.map((_, i) => (i === rows.length - 2 ? 'subtotal' : 'row')),
          },
        },
        ...(notes.length ? [{ heading: 'Notes', paragraphs: notes }] : []),
      ],
    });
    return pdfResponse(buf, `rollforward-${toISODate(from)}-${toISODate(to)}.pdf`);
  } catch (e) {
    return pdfErrorResponse(e);
  }
}
