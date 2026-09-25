import { notFound } from 'next/navigation';
import {
  ButtonLink,
  Card,
  DataTable,
  DateText,
  NumTd,
  PageHeader,
  Period,
  ProgressBar,
  Td,
  Th,
  TotalRow,
} from '@/components/ui';
import { getOrgId } from '@/lib/org';
import { defaultReportDate } from '@/services/bva';
import { budgetTree } from '@/services/grant-budget';
import { grantHeader } from '@/services/grant-workspace';
import { GrantTabs } from '../tabs';

export const dynamic = 'force-dynamic';

/** The grant in the funder's own categories: budget, charged, remaining. */
export default async function FunderViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ asOf?: string }>;
}) {
  const { id } = await params;
  const { asOf } = await searchParams;
  const orgId = await getOrgId();
  const grant = await grantHeader(orgId, id);
  if (!grant) notFound();
  const { date, label } = await defaultReportDate(orgId, asOf);
  const tree = await budgetTree(orgId, id, date);
  const remaining = tree.totals.budgetCents - tree.totals.chargedCents;
  return (
    <>
      <PageHeader
        title={grant.name}
        subtitle={
          <>
            {grant.funder} · <Period from={grant.startDate} to={grant.endDate} />
          </>
        }
        secondaryActions={
          <>
            <ButtonLink href={`/grants/${id}/funder/xlsx?asOf=${label}`} variant="secondary">
              XLSX
            </ButtonLink>
            <ButtonLink href={`/grants/${id}/funder/pdf?asOf=${label}`} variant="secondary">
              PDF
            </ButtonLink>
          </>
        }
      />
      <GrantTabs id={id} active="funder" />
      <Card
        title="Funder view"
        action={
          <span className="muted text-sm">
            As of <DateText date={date} /> · run {tree.runId ? tree.runId.slice(0, 8) : 'none'}
          </span>
        }
      >
        <DataTable stickyFirstColumn>
          <thead>
            <tr>
              <Th>Category / working line</Th>
              <Th num>Budget ($)</Th>
              <Th num>Charged ($)</Th>
              <Th num>Remaining ($)</Th>
              <Th num>Used</Th>
            </tr>
          </thead>
          <tbody>
            {tree.categories.map((c) => (
              <CategoryRows key={c.id} category={c} />
            ))}
            {tree.loose.length > 0 && tree.categories.length > 0 && (
              <tr>
                <Th scope="row" colSpan={5}>
                  Lines without a funder category
                </Th>
              </tr>
            )}
            {tree.loose.map((l) => (
              <LineRow key={l.id} line={l} />
            ))}
            <TotalRow data-testid="funder-total">
              <Th scope="row">Total</Th>
              <NumTd cents={tree.totals.budgetCents} dollar data-testid="funder-budget" />
              <NumTd cents={tree.totals.chargedCents} dollar data-testid="funder-charged" />
              <NumTd cents={remaining} dollar />
              <NumTd>
                <ProgressBar
                  used={tree.totals.chargedCents}
                  budget={tree.totals.budgetCents}
                  label="Total budget used"
                />
              </NumTd>
            </TotalRow>
          </tbody>
        </DataTable>
      </Card>
    </>
  );
}

type Line = Awaited<ReturnType<typeof budgetTree>>['categories'][number];

function CategoryRows({ category: c }: { category: Line }) {
  return (
    <>
      <tr className="font-semibold" data-testid="funder-category" data-code={c.code}>
        <Th scope="row">{c.name}</Th>
        <NumTd cents={c.currentCents} />
        <NumTd cents={c.chargedCents} data-testid="category-charged" />
        <NumTd cents={c.currentCents - c.chargedCents} />
        <NumTd>
          <ProgressBar used={c.chargedCents} budget={c.currentCents} label={`${c.name} used`} />
        </NumTd>
      </tr>
      {c.children.map((l) => (
        <LineRow key={l.id} line={l} />
      ))}
    </>
  );
}

function LineRow({ line: l }: { line: Line }) {
  return (
    <tr data-testid="funder-line" data-code={l.code}>
      <Td className="pl-6">
        {l.name}
        <span className="muted block text-xs">{l.code}</span>
      </Td>
      <NumTd cents={l.currentCents} />
      <NumTd cents={l.chargedCents} data-testid="line-charged" />
      <NumTd cents={l.currentCents - l.chargedCents} />
      <NumTd>
        <ProgressBar used={l.chargedCents} budget={l.currentCents} label={`${l.name} used`} />
      </NumTd>
    </tr>
  );
}
