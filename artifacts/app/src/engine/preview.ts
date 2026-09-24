/**
 * Server-rendered rule previews (JPH-9 / JPH-10): which source lines a set of
 * matchers would capture in a date range. For crosswalk rules the program is
 * the *allocated* program, so we evaluate against the current run's pieces
 * when one exists; otherwise the class→program default is used.
 */
import { lineMatches, type Matchers } from '@/domain/matchers';
import { prisma } from '@/lib/db';
import { defaultProgramFor } from './core';
import { loadEngineConfig, loadEngineLines } from './recompute';

export interface PreviewLine {
  sourceLineId: string;
  txnDate: Date;
  docNumber: string | null;
  account: string;
  className: string | null;
  party: string | null;
  description: string | null;
  programCode: string | null;
  amountCents: number;
}

export interface PreviewResult {
  count: number;
  totalCents: number;
  sample: PreviewLine[];
  basis: 'current_run' | 'class_default';
}

export async function previewMatchers(
  orgId: string,
  matchers: Matchers,
  range: { from: Date; to: Date },
  opts: {
    kind: 'allocation' | 'crosswalk';
    effectiveFrom?: Date | null;
    effectiveTo?: Date | null;
    sampleSize?: number;
  } = { kind: 'crosswalk' },
): Promise<PreviewResult> {
  const [{ lines }, config, run] = await Promise.all([
    loadEngineLines(orgId),
    loadEngineConfig(orgId),
    prisma.computeRun.findFirst({ where: { orgId, isCurrent: true } }),
  ]);
  const inRange = lines.filter(
    (l) =>
      l.txnDate >= range.from &&
      l.txnDate <= range.to &&
      (opts.kind === 'allocation' || l.accountKind === 'expense'),
  );
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  // program per (line, piece): from the current run when available
  let programOf: (lineId: string) => Array<{ programId: string | null; amountCents: number }>;
  let basis: PreviewResult['basis'] = 'class_default';
  if (opts.kind === 'crosswalk' && run) {
    const pieces = await prisma.allocatedLine.findMany({
      where: { computeRunId: run.id, sourceLineId: { in: inRange.map((l) => l.id) } },
      select: { sourceLineId: true, programId: true, amountCents: true },
    });
    const byLine = new Map<string, Array<{ programId: string | null; amountCents: number }>>();
    for (const p of pieces)
      (byLine.get(p.sourceLineId) ?? byLine.set(p.sourceLineId, []).get(p.sourceLineId)!).push(p);
    programOf = (id) => byLine.get(id) ?? [];
    basis = 'current_run';
  } else {
    const lineById = new Map(inRange.map((l) => [l.id, l]));
    programOf = (id) => {
      const l = lineById.get(id)!;
      return [{ programId: defaultProgramFor(l, config.programs), amountCents: l.amountCents }];
    };
  }

  const hits: Array<{ lineId: string; programId: string | null; amountCents: number }> = [];
  for (const l of inRange) {
    if (opts.kind === 'allocation') {
      if (opts.effectiveFrom && iso(l.txnDate) < iso(opts.effectiveFrom)) continue;
      if (opts.effectiveTo && iso(l.txnDate) > iso(opts.effectiveTo)) continue;
      const m = { ...l, programId: null };
      if (lineMatches(m, { ...matchers, programIds: undefined }))
        hits.push({
          lineId: l.id,
          programId: defaultProgramFor(l, config.programs),
          amountCents: l.amountCents,
        });
      continue;
    }
    for (const piece of programOf(l.id)) {
      if (lineMatches({ ...l, programId: piece.programId }, matchers))
        hits.push({ lineId: l.id, programId: piece.programId, amountCents: piece.amountCents });
    }
  }

  const sampleIds = [...new Set(hits.slice(0, opts.sampleSize ?? 25).map((h) => h.lineId))];
  const rows = await prisma.transactionLine.findMany({
    where: { id: { in: sampleIds } },
    include: { account: true, class: true, party: true, transaction: { include: { party: true } } },
  });
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const programs = await prisma.program.findMany({
    where: { orgId },
    select: { id: true, code: true },
  });
  const codeOf = new Map(programs.map((p) => [p.id, p.code]));
  const sample: PreviewLine[] = hits.slice(0, opts.sampleSize ?? 25).map((h) => {
    const r = rowById.get(h.lineId)!;
    return {
      sourceLineId: r.id,
      txnDate: r.transaction.txnDate,
      docNumber: r.transaction.docNumber,
      account: r.account.number ? `${r.account.number} ${r.account.name}` : r.account.name,
      className: r.class?.name ?? null,
      party: r.party?.displayName ?? r.transaction.party?.displayName ?? null,
      description: r.description ?? r.transaction.memo,
      programCode: h.programId ? (codeOf.get(h.programId) ?? null) : null,
      amountCents: h.amountCents,
    };
  });
  return {
    count: hits.length,
    totalCents: hits.reduce((a, h) => a + h.amountCents, 0),
    sample,
    basis,
  };
}
