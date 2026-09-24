'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getOrgId } from '@/lib/org';
import { redirectWithErrors, str } from '@/lib/forms';
import { parseParams } from '@/reports/params';

export async function saveView(form: FormData) {
  const name = z.string().trim().min(1).max(120).safeParse(str(form, 'name'));
  const query = str(form, 'query');
  if (!name.success)
    redirectWithErrors('/reports', { name: 'Enter a name (max 120 characters).' }, form);
  try {
    parseParams(new URLSearchParams(query));
  } catch {
    redirectWithErrors('/reports', { query: 'Invalid report parameters.' }, form);
  }
  await prisma.savedView.create({
    data: { orgId: await getOrgId(), name: name.data, path: '/reports/custom', queryString: query },
  });
  redirect('/reports?saved=1');
}
export async function deleteView(form: FormData) {
  await prisma.savedView.deleteMany({ where: { orgId: await getOrgId(), id: str(form, 'id') } });
  redirect('/reports?saved=1');
}
