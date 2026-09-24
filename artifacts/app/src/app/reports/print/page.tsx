import { getOrgId } from '@/lib/org';
import { dimensionLabels, parseParams } from '@/reports/params';
import { loadReport } from '@/reports/query';
import { pageKeys } from '@/reports/export';
import { ReportTable } from '../table';
export const dynamic = 'force-dynamic';
export default async function Print({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = parseParams(await searchParams),
    { org, run, facts } = await loadReport(await getOrgId(), p);
  return (
    <main>
      <style>{`@page { size: letter landscape; margin: 0.55in; @bottom-right { content: "Page " counter(page); } } @media print { body { font: 10pt Arial; } thead { display: table-header-group; } tfoot { display: table-footer-group; } .card { break-inside: avoid; box-shadow: none; } a { color: black; text-decoration: none; } }`}</style>
      <header>
        <h1>{org.name}</h1>
        <h2>
          {dimensionLabels[p.rows]} × {dimensionLabels[p.cols]}
        </h2>
        <p>
          Period: {p.from ?? 'All'} — {p.to ?? 'All'} · Run: {run?.id ?? 'None'} ·{' '}
          {(run?.finishedAt ?? run?.startedAt)?.toISOString() ?? ''}
        </p>
      </header>
      {pageKeys(facts, p).map((k) => (
        <ReportTable key={k ?? '_'} facts={facts} params={p} query="" pageKey={k} links={false} />
      ))}
    </main>
  );
}
