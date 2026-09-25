import { toISODate } from '@/domain/dates';
import { getOrgId } from '@/lib/org';
import { rollforwardXlsx } from '@/reports/rollforward-xlsx';
import { xlsxResponse } from '@/reports/table-export';
import { rollforward } from '@/services/grant-periods';
import { rollforwardNotes } from '@/services/grant-workspace';
import { resolveRange } from '../range';

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const orgId = await getOrgId();
  const { from, to, error } = await resolveRange(orgId, {
    range: sp.get('range') ?? undefined,
    from: sp.get('from') ?? undefined,
    to: sp.get('to') ?? undefined,
  });
  if (error) return new Response(error, { status: 400 });
  const rf = await rollforward(orgId, from, to);
  const notes: Array<{ grant: string; text: string }> = [];
  for (const r of rf.rows) {
    for (const p of r.priorPeriods)
      notes.push({ grant: r.name, text: `Beginning balance from ${p.name} (${p.source}).` });
    for (const n of await rollforwardNotes(orgId, r.grantId)) notes.push({ grant: r.name, text: n.text });
  }
  const buf = await rollforwardXlsx(rf, notes);
  return xlsxResponse(buf, `rollforward-${toISODate(from)}-${toISODate(to)}.xlsx`);
}
