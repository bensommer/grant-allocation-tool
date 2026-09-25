import { toISODate } from '@/domain/dates';
import { formatMoney } from '@/domain/format';
import { getOrgId } from '@/lib/org';
import { pdfDocument, pdfErrorResponse, pdfResponse } from '@/reports/pdf';
import type { TableCell } from '@/reports/table-export';
import { grantHeader, tieOut } from '@/services/grant-workspace';

/** Print layout of the tie-out ledger: assigned + excluded + needs review = coded; effort; charged. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const orgId = await getOrgId();
  const grant = await grantHeader(orgId, id);
  if (!grant) return new Response('Not found', { status: 404 });
  const t = await tieOut(orgId, id);
  const money = (cents: number) => formatMoney(cents, { zero: 'zero' });
  const rows: TableCell[][] = [
    ['', 'Assigned to budget lines', money(t.assignedCents)],
    ['+', 'Excluded by decision', money(t.excludedCents)],
    ['+', 'Needs review', money(t.needsReviewCents)],
    ['=', 'Coded to the grant', money(t.codedCents)],
    ['', 'Effort charges (no transaction date)', money(t.effortCents)],
    ['', 'Charged (assigned + effort)', money(t.chargedCents)],
  ];
  const status =
    t.status === 'clean'
      ? 'Ties out — nothing waiting for review.'
      : t.status === 'pairs'
        ? `${t.pendingPairs} reversal pair(s) proposed, netting ${money(t.needsReviewCents)}; not green until confirmed.`
        : `${t.needsReviewCount} line(s) waiting for review.`;
  const paragraphs = [status];
  if (t.excluded.length)
    paragraphs.push(
      'Excluded by reason: ' +
        t.excluded.map((x) => `${x.reason} ${money(x.cents)}`).join('; ') +
        '.',
    );
  try {
    const buf = await pdfDocument({
      title: `${grant.name} — tie-out`,
      subtitle: `${grant.funder} · current run${t.stale ? ' (stale)' : ''}`,
      parameters: { Grant: grant.name, Generated: toISODate(new Date()) },
      sections: [
        {
          paragraphs,
          table: {
            title: 'Tie-out',
            parameters: {},
            headers: ['', 'Line', 'Amount'],
            rows,
            colAlign: ['left', 'left', 'right'],
            rowKinds: rows.map((_, i) => (i === 3 || i === 5 ? 'subtotal' : 'row')),
          },
        },
      ],
      portrait: true,
    });
    return pdfResponse(buf, `tie-out-${grant.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`);
  } catch (e) {
    return pdfErrorResponse(e);
  }
}
