import { Button, ButtonLink, Card, PageHeader } from '@/components/ui';
import { decodeFormState, pick } from '@/lib/forms';
import { getOrgId } from '@/lib/org';
import { prisma } from '@/lib/db';
import { getDefaultDestination, getPacingSettings, isDestinationSet } from '@/services/settings';
import { saveDestinationAction, saveSettingsAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; saved?: string }>;
}) {
  const { f, saved } = await searchParams;
  const orgId = await getOrgId();
  const [settings, destination, classes, parties] = await Promise.all([
    getPacingSettings(orgId),
    getDefaultDestination(orgId),
    prisma.trackingClass.findMany({ where: { orgId, active: true }, orderBy: { name: 'asc' } }),
    prisma.party.findMany({
      where: { orgId, kind: { in: ['customer', 'project'] } },
      orderBy: { displayName: 'asc' },
    }),
  ]);
  const state = decodeFormState(f);
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Configure grant pacing thresholds and the default destination for correcting entries."
      />
      {saved && <div className="banner banner-ok">Settings saved.</div>}
      <Card title="Pacing thresholds">
        <form action={saveSettingsAction} className="flex flex-wrap items-end gap-4">
          <label>
            Under pace threshold (%)
            <input
              type="number"
              name="underPercent"
              min="0"
              max="100"
              step="0.1"
              required
              defaultValue={pick(state, 'underPercent', String(settings.underPercent))}
            />
            {state?.errors.underPercent && (
              <span className="text-red-700">{state.errors.underPercent}</span>
            )}
          </label>
          <label>
            Over pace threshold (%)
            <input
              type="number"
              name="overPercent"
              min="0"
              max="100"
              step="0.1"
              required
              defaultValue={pick(state, 'overPercent', String(settings.overPercent))}
            />
            {state?.errors.overPercent && (
              <span className="text-red-700">{state.errors.overPercent}</span>
            )}
          </label>
          <Button>Save thresholds</Button>
        </form>
      </Card>
      <div className="mt-4" id="destination">
        <Card title="Default destination for correcting entries">
          <p className="muted mb-3 text-sm">
            Where excluded costs and effort true-ups are moved to: a class and/or a project /
            customer. Correcting entries cannot be drafted until at least one is set.
            {isDestinationSet(destination) ? null : (
              <strong className="ml-1" data-testid="destination-unset">
                Not set.
              </strong>
            )}
          </p>
          <form action={saveDestinationAction} className="flex flex-wrap items-end gap-4">
            <label>
              Class
              <select
                name="defaultDestinationClassId"
                defaultValue={pick(state, 'defaultDestinationClassId', destination.classId ?? '')}
              >
                <option value="">— none —</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Project / customer
              <select
                name="defaultDestinationPartyId"
                defaultValue={pick(state, 'defaultDestinationPartyId', destination.partyId ?? '')}
              >
                <option value="">— none —</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>
            </label>
            {state?.errors.destination && (
              <span className="text-red-700">{state.errors.destination}</span>
            )}
            <Button>Save destination</Button>
          </form>
        </Card>
      </div>
      <p className="mt-4">
        <ButtonLink href="/settings/periods" variant="secondary">
          Reporting period locks
        </ButtonLink>
      </p>
      <p className="muted mt-4 text-sm">
        A grant is flagged when actual spending is more than the configured percentage below or
        above expected straight-line spending. Defaults: 15% under, 10% over.
      </p>
    </>
  );
}
