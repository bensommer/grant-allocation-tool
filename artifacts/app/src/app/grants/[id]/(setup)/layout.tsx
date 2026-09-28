import { headers } from 'next/headers';
import { SetupRail, setupSectionFor } from './setup-rail';

/**
 * Every Setup-tab page (grant details, budget, rules, periods, history, narratives) sits to
 * the right of the setup rail. The URL comes from the proxy's `x-pathname` header.
 */
export default async function SetupLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const pathname = (await headers()).get('x-pathname') ?? `/grants/${id}/edit`;
  return (
    <div className="md:grid md:grid-cols-[12rem_minmax(0,1fr)] md:gap-6">
      <SetupRail id={id} current={setupSectionFor(pathname)} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
