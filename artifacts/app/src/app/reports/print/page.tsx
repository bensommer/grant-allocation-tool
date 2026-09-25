import { getOrgId } from '@/lib/org';
import { dimensionLabels, parseParams } from '@/reports/params';
import { loadReport } from '@/reports/query';
import { ReportSections } from '../table';
import { DateText } from '@/components/ui';
import { budgetColumnsNote, reportSections } from '@/reports/view';
export const dynamic = 'force-dynamic';
export default async function Print({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = parseParams(await searchParams),
    { org, run, facts, budgets } = await loadReport(await getOrgId(), p);
  return (
    <main>
      <style>{`@page { size: letter landscape; margin: 0.55in; @bottom-right { content: "Page " counter(page); } } @media print { body { font: 10pt Arial; } thead { display: table-header-group; } tfoot { display: table-footer-group; } .card { break-inside: avoid; box-shadow: none; } a { color: black; text-decoration: none; } }`}</style>
      <header>
        <h1>{org.name}</h1>
        <h2>
          {dimensionLabels[p.rows]} × {dimensionLabels[p.cols]}
        </h2>
        <p>
          Period: {p.from ? <DateText date={new Date(`${p.from}T00:00:00Z`)} /> : 'All'} —{' '}
          {p.to ? <DateText date={new Date(`${p.to}T00:00:00Z`)} /> : 'All'} · Run:{' '}
          {run?.id ?? 'None'} · {run && <DateText date={run.finishedAt ?? run.startedAt} time />}
        </p>
      </header>
      {budgetColumnsNote(p) && (
        <p className="muted">
          Budget columns are shown when the report is broken by grant or not at all
        </p>
      )}
      <ReportSections sections={reportSections(facts, p, budgets)} params={p} query="" links={false} />
    </main>
  );
}
