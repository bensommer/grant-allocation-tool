import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { FormBanner } from '@/components/form';
import {
  Banner,
  Button,
  DangerZone,
  DataTable,
  DateText,
  NumTd,
  StatusPill,
  Th,
  type Tone,
} from '@/components/ui';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { decodeFormState, pick } from '@/lib/forms';
import { GRANT_CODING_MISSING_MESSAGE, listDrafts } from '@/services/correcting-entries';
import { getDefaultDestination, isDestinationSet } from '@/services/settings';
import { GrantTabs } from '../tabs';
import { voidDraftAction } from '../effort/actions';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<'drafted' | 'posted' | 'void', Tone> = {
  drafted: 'info',
  posted: 'ok',
  void: 'muted',
};
const KIND_LABEL = { reclass: 'Reclass', true_up: 'True-up' } as const;

export default async function EntriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ f?: string; saved?: string; drafted?: string }>;
}) {
  const { id } = await params;
  const { f, saved, drafted } = await searchParams;
  const orgId = await getOrgId();
  const grant = await prisma.grant.findFirst({ where: { id, orgId } });
  if (!grant) notFound();
  const [drafts, destination] = await Promise.all([
    listDrafts(orgId, id),
    getDefaultDestination(orgId),
  ]);
  const state = decodeFormState(f);
  const open = drafts.filter((d) => d.status === 'drafted');

  return (
    <>
      <PageHeader
        title={`${grant.name} · correcting entries`}
        subtitle="Draft journal entries (reclass and effort true-up) to post in QuickBooks. Export, post, then re-import the grant export; a draft whose code appears in a posted entry's memo is marked posted automatically. Drafts are voided, never deleted."
      />
      <GrantTabs id={id} active="entries" />
      <FormBanner state={state} saved={!!saved} />
      {drafted ? (
        <div data-testid="draft-created">
          <Banner tone="ok">
            Correcting entry <code>{drafted}</code> drafted.
          </Banner>
        </div>
      ) : null}
      {isDestinationSet(destination) ? null : (
        <Banner tone="warn">
          No default destination is set — drafting is blocked until one is chosen in{' '}
          <Link href="/settings#destination">Settings</Link>.
        </Banner>
      )}
      {grant.memberClassIds.length === 0 &&
      grant.memberPartyIds.length === 0 &&
      !grant.qboClassName?.trim() &&
      !grant.qboProjectName?.trim() ? (
        <div data-testid="grant-coding-missing">
          <Banner tone="warn">
            {GRANT_CODING_MISSING_MESSAGE} <Link href={`/grants/${id}/edit`}>Edit grant</Link>.
          </Banner>
        </div>
      ) : null}
      {drafts.length === 0 ? (
        <Banner tone="info">
          No correcting entries yet. Draft one from the <Link href={`/grants/${id}/review`}>review queue</Link>{' '}
          (exclude with “Draft correcting entry”) or the <Link href={`/grants/${id}/effort`}>effort</Link>{' '}
          page (Draft true-up).
        </Banner>
      ) : (
        <DataTable caption="Correcting entries">
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Kind</Th>
              <Th>Status</Th>
              <Th>Date</Th>
              <Th>Memo</Th>
              <Th num>Lines</Th>
              <Th num>Amount ($)</Th>
              <Th>Export</Th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((d) => (
              <tr key={d.id} data-code={d.code} data-status={d.status} data-kind={d.kind}>
                <th scope="row">
                  <code>{d.code}</code>
                </th>
                <td>{KIND_LABEL[d.kind]}</td>
                <td>
                  <StatusPill tone={STATUS_TONE[d.status]}>{d.status}</StatusPill>
                  {d.status === 'void' && d.voidNote ? (
                    <small className="muted block">{d.voidNote}</small>
                  ) : null}
                </td>
                <td>
                  <DateText date={d.date} />
                </td>
                <td className="max-w-md">{d.memo}</td>
                <td className="num">{d.lines.length}</td>
                <NumTd cents={d.amountCents} data-testid="amount" />
                <td className="whitespace-nowrap">
                  <a href={`/grants/${id}/entries/${d.code}/csv`} data-testid="csv">
                    CSV
                  </a>{' '}
                  ·{' '}
                  <a href={`/grants/${id}/entries/${d.code}/pdf`} data-testid="pdf">
                    PDF
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      {open.length > 0 ? (
        <DangerZone title="Void a draft">
          <form
            action={voidDraftAction.bind(null, id)}
            className="flex flex-wrap items-end gap-3"
            data-testid="void-form"
          >
            <label className="text-sm">
              Draft
              <select name="draftId" defaultValue={pick(state, 'draftId', open[0]!.id)}>
                {open.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code} · {KIND_LABEL[d.kind]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Note (required)
              <input name="note" required defaultValue={pick(state, 'note', '')} />
            </label>
            <Button variant="danger">Void draft</Button>
            {state?.errors['note'] ? <p className="field-error">{state.errors['note']}</p> : null}
            {state?.errors['_'] ? <p className="field-error">{state.errors['_']}</p> : null}
          </form>
        </DangerZone>
      ) : null}
    </>
  );
}
