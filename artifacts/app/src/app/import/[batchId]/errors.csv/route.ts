import { prisma } from '@/lib/db';
import type { ImportError } from '@/datasource/types';

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(_req: Request, ctx: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await ctx.params;
  const batch = await prisma.importBatch.findUnique({
    where: { id: batchId },
    select: { errors: true },
  });
  if (!batch) return new Response('Not found', { status: 404 });
  const errors = batch.errors as unknown as ImportError[];
  const lines = ['file,row,column,code,message'];
  for (const e of errors)
    lines.push([e.file, e.row, e.column, e.code, e.message].map(csvCell).join(','));
  return new Response(lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="import-${batchId}-errors.csv"`,
    },
  });
}
