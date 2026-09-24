import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Button,
  ButtonLink,
  Card,
  DataTable,
  DateText,
  NumTd,
  PageHeader,
  Period,
  StatusPill,
  Toolbar,
} from '@/components/ui';
import { decodeFormState, pick } from '@/lib/forms';
import { getOrgId } from '@/lib/org';
import { extractNumbers } from '@/narratives/numbers';
import type { GroundingPacket } from '@/narratives/packet';
import { getNarrative, parseDraft } from '@/narratives/service';
import { verifyDraft } from '@/narratives/verify';
import { editAction, regenerateAction } from '../actions';

export const dynamic = 'force-dynamic';
export default async function Editor({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; nid: string }>;
  searchParams: Promise<{ f?: string; saved?: string; print?: string }>;
}) {
  const { id, nid } = await params;
  const { f, saved, print } = await searchParams;
  const narrative = await getNarrative(await getOrgId(), id, nid);
  if (!narrative) notFound();
  const packet = narrative.packetJson as unknown as GroundingPacket;
  const state = decodeFormState(f);
  const draft = parseDraft(narrative.editedJson ?? narrative.draftJson);
  const sections = draft.sections.map((s, i) => ({ ...s, body: pick(state, `body-${i}`, s.body) }));
  const verification = verifyDraft({ sections }, packet);
  const acknowledged = narrative.verification as unknown as {
    sectionIndex: number;
    start: number;
    text: string;
    acknowledged?: boolean;
  }[];
  return (
    <>
      <PageHeader
        title={`${packet.grant.name} · ${narrative.template}`}
        subtitle={
          <>
            <Period
              from={new Date(`${packet.period.from}T00:00:00Z`)}
              to={new Date(`${packet.period.to}T00:00:00Z`)}
            />{' '}
            · Version {narrative.version} ·{' '}
            <StatusPill tone={narrative.status === 'approved' ? 'ok' : 'info'}>
              {narrative.status}
            </StatusPill>
          </>
        }
        primaryAction={
          <Button
            type="submit"
            form="narrative-editor"
            name="intent"
            value={narrative.status === 'approved' ? 'save' : 'approve'}
          >
            {narrative.status === 'approved' ? 'New version' : 'Approve'}
          </Button>
        }
        secondaryActions={
          <ButtonLink variant="secondary" href={`/grants/${id}/narratives`}>
            ← Narratives
          </ButtonLink>
        }
      />
      <Toolbar>
        <ButtonLink variant="secondary" size="sm" href={`/grants/${id}/narratives/${nid}/docx`}>
          Export DOCX
        </ButtonLink>
        <ButtonLink variant="secondary" size="sm" href={`/grants/${id}/narratives/${nid}/pdf`}>
          Export PDF
        </ButtonLink>
      </Toolbar>
      {saved && <div className="banner banner-ok no-print">Narrative saved.</div>}
      {state?.errors._ && (
        <div className="banner banner-warn no-print" role="alert">
          {state.errors._}
        </div>
      )}
      {narrative.status === 'approved' && (
        <div className="banner no-print">
          Approved by {narrative.approvedBy} on{' '}
          {narrative.approvedAt && <DateText date={narrative.approvedAt} />}. Saving an edit creates
          a new draft version.
        </div>
      )}
      <form id="narrative-editor" action={editAction.bind(null, id, nid)}>
        {sections.map((s, i) => {
          const issues = verification.filter((v) => v.sectionIndex === i);
          const tokens = extractNumbers(s.body);
          let offset = 0;
          return (
            <Card key={i} title={s.heading}>
              <label className="no-print">
                Edit section
                <textarea name={`body-${i}`} rows={7} defaultValue={s.body} className="w-full" />
              </label>
              <div
                className="mt-2 whitespace-pre-wrap"
                aria-label={`Read-only preview: ${s.heading}`}
              >
                {tokens.flatMap((token, j) => {
                  const before = s.body.slice(offset, token.start);
                  offset = token.end;
                  const v = issues[j];
                  return [before, v && !v.matched ? <mark key={j}>{token.text}</mark> : token.text];
                })}
                {s.body.slice(offset)}
              </div>
              <div className="no-print mt-2">
                <strong>Number verification</strong>
                {issues.length === 0 && <p className="muted">No amounts or percentages cited.</p>}
                {issues.length > 0 && (
                  <DataTable caption={`${s.heading} number verification`}>
                    <thead>
                      <tr>
                        <th>Value</th>
                        <th>Verification</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {issues.map((v, j) => {
                        const key = `${i}:${v.start}:${v.text}`;
                        const checked = acknowledged.some(
                          (a) =>
                            a.sectionIndex === i &&
                            a.start === v.start &&
                            a.text === v.text &&
                            a.acknowledged,
                        );
                        return (
                          <tr key={j}>
                            <td>{v.text}</td>
                            <td>
                              <StatusPill tone={v.matched ? 'ok' : 'warn'}>
                                {v.matched ? `Verified (${v.matchedKey})` : 'Unverified'}
                              </StatusPill>
                            </td>
                            <td>
                              {!v.matched && (
                                <label className="ml-2">
                                  <input
                                    type="checkbox"
                                    name="acknowledge"
                                    value={key}
                                    defaultChecked={checked}
                                  />{' '}
                                  Acknowledge
                                </label>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </DataTable>
                )}
                {narrative.status !== 'approved' && (
                  <button
                    className="btn btn-secondary btn-sm"
                    type="submit"
                    formAction={regenerateAction.bind(null, id, nid, i)}
                  >
                    Regenerate section
                  </button>
                )}
              </div>
            </Card>
          );
        })}
        <div className="no-print">
          <button className="btn" name="intent" value="save">
            Save {narrative.status === 'approved' ? 'as new version' : 'edits'}
          </button>{' '}
          {narrative.status !== 'approved' && (
            <button className="btn btn-secondary" name="intent" value="approve">
              Approve
            </button>
          )}
        </div>
      </form>
      <Card title="Budget vs actual">
        <DataTable caption="Narrative budget vs actual">
          <thead>
            <tr>
              <th>Budget line</th>
              <th className="num">Budget</th>
              <th className="num">Actual</th>
              <th className="num">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {packet.rows.map((r) => (
              <tr key={r.code}>
                <td>
                  {r.name} <small className="muted">· {r.code}</small>
                </td>
                <NumTd cents={r.budgetCents} />
                <NumTd cents={r.actualCents} />
                <NumTd cents={r.remainingCents} />
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Card>
    </>
  );
}
