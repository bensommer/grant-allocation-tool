import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { formatCents, formatPct1 } from '@/domain/money';
import { toISODate } from '@/domain/dates';
import { spentByGrant } from '@/services/grants';
import { GRANT_STATUS_LABEL, type GrantStatusKey, RESTRICTION_LABEL } from './labels';

export const dynamic = 'force-dynamic';
const STATUSES = Object.keys(GRANT_STATUS_LABEL) as GrantStatusKey[];

export default async function GrantsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; deleted?: string }>;
}) {
  const { status, deleted } = await searchParams;
  const orgId = await getOrgId();
  const filter = STATUSES.includes(status as GrantStatusKey)
    ? (status as GrantStatusKey)
    : undefined;
  const [grants, spent] = await Promise.all([
    prisma.grant.findMany({
      where: { orgId, ...(filter ? { status: filter } : {}) },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    }),
    spentByGrant(orgId),
  ]);

  return (
    <>
      <PageHeader
        title="Grants"
        subtitle="Awards and their funder budget lines. % spent comes from the current compute run."
        actions={
          <Link href="/grants/new" className="btn">
            New grant
          </Link>
        }
      />
      {deleted ? <div className="banner banner-ok">Grant deleted.</div> : null}
      <form method="get" className="no-print mb-3 flex items-end gap-2">
        <div>
          <label htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={filter ?? ''}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {GRANT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-secondary">
          Filter
        </button>
      </form>
      <div className="card">
        {grants.length === 0 ? (
          <p className="muted">
            No grants{filter ? ` with status ${GRANT_STATUS_LABEL[filter]}` : ''}.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Funder</th>
                <th className="num">Award</th>
                <th>Period</th>
                <th>Restriction</th>
                <th>Status</th>
                <th className="num">% spent</th>
              </tr>
            </thead>
            <tbody>
              {grants.map((g) => (
                <tr key={g.id}>
                  <td>
                    <Link href={`/grants/${g.id}`}>{g.name}</Link>
                  </td>
                  <td>{g.funder}</td>
                  <td className="num">{formatCents(g.awardAmountCents)}</td>
                  <td>
                    {toISODate(g.startDate)} → {toISODate(g.endDate)}
                  </td>
                  <td>{RESTRICTION_LABEL[g.restrictionType]}</td>
                  <td>
                    <span className={`pill ${g.status === 'active' ? 'pill-ok' : 'pill-muted'}`}>
                      {GRANT_STATUS_LABEL[g.status]}
                    </span>
                  </td>
                  <td className="num">
                    {spent ? formatPct1(spent.get(g.id) ?? 0, g.awardAmountCents) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
