import { DataTable, EmptyState, PageHeader, StatusPill, Th } from '@/components/ui';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const orgId = await getOrgId();
  const accounts = await prisma.account.findMany({
    where: { orgId, deletedAt: null },
    orderBy: [{ number: 'asc' }, { name: 'asc' }],
  });
  return (
    <>
      <PageHeader title="Accounts" subtitle="Imported chart of accounts." />
      {accounts.length ? (
        <DataTable caption="Chart of accounts">
          <thead>
            <tr>
              <Th>Account</Th>
              <Th>Type</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.id}>
                <td>
                  {account.name}
                  <span className="muted block text-xs">{account.number}</span>
                </td>
                <td className="muted">{account.type}</td>
                <td>
                  <StatusPill tone={account.active ? 'ok' : 'muted'}>
                    {account.active ? 'Active' : 'Inactive'}
                  </StatusPill>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : (
        <EmptyState title="No accounts imported yet" />
      )}
    </>
  );
}
