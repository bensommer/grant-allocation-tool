/**
 * POST /api/rules/preview?kind=crosswalk|grant&grantId=…&ruleId=… (JPH-26 B3)
 *
 * Body: the rule builder's form, as multipart/form-data (the island posts `new FormData(form)`).
 * Response: RulePreviewData — count, total and the first ten matching transactions in the app
 * period, plus the superset warning. Reads the form with the same `readRuleValues` the server
 * actions use, so the preview and the saved rule always agree.
 */
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { currentPeriod } from '@/lib/period';
import { formDataReader, readRuleValues } from '@/lib/rule-form';
import { previewRuleForm } from '@/services/rule-preview';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const kind = req.nextUrl.searchParams.get('kind');
  const grantId = req.nextUrl.searchParams.get('grantId') ?? undefined;
  const ruleId = req.nextUrl.searchParams.get('ruleId') ?? undefined;
  if (kind !== 'crosswalk' && kind !== 'grant')
    return Response.json({ error: 'kind must be crosswalk or grant' }, { status: 400 });
  if (kind === 'grant' && !grantId)
    return Response.json({ error: 'grantId is required for grant rules' }, { status: 400 });
  const orgId = await getOrgId();
  if (grantId) {
    const grant = await prisma.grant.findFirst({
      where: { id: grantId, orgId },
      select: { id: true },
    });
    if (!grant) return Response.json({ error: 'grant not found' }, { status: 404 });
  }
  const values = readRuleValues(formDataReader(await req.formData()), kind);
  const { range } = await currentPeriod(orgId);
  const data = await previewRuleForm(orgId, { kind, values, range, grantId, ruleId });
  return Response.json(data);
}
