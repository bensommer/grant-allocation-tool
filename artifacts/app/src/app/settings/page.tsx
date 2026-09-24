import { Button, ButtonLink, Card, PageHeader } from '@/components/ui';
import { decodeFormState, pick } from '@/lib/forms';
import { getOrgId } from '@/lib/org';
import { getPacingSettings } from '@/services/settings';
import { saveSettingsAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; saved?: string }>;
}) {
  const { f, saved } = await searchParams;
  const settings = await getPacingSettings(await getOrgId());
  const state = decodeFormState(f);
  return (
    <>
      <PageHeader title="Settings" subtitle="Configure grant pacing thresholds." />
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
