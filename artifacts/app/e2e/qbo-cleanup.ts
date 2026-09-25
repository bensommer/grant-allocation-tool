import { prisma } from '../src/lib/db';

/**
 * Test-only cleanup: remove everything QuickBooks report imports wrote for an
 * org so the demo fixture (and the visual baselines captured from it) stay
 * exactly as documented. The app itself never hard-deletes imported rows.
 *
 * Callers must not run while another spec is importing: the report spec has
 * its own Playwright projects that run after the functional ones, serially.
 */
export async function removeQboReportData(orgId: string): Promise<void> {
  const batch = (table: string) =>
    `USING "ImportBatch" b WHERE ${table}."importBatchId" = b.id AND b."orgId" = $1 AND b."sourceSystem" = 'qbo_report'`;
  const statements = [
    `DELETE FROM "AllocatedLine" a USING "TransactionLine" l, "Transaction" t, "ImportBatch" b
       WHERE a."sourceLineId" = l.id AND l."transactionId" = t.id AND t."importBatchId" = b.id
         AND b."orgId" = $1 AND b."sourceSystem" = 'qbo_report'`,
    `DELETE FROM "GrantMembership" m USING "TransactionLine" l, "Transaction" t, "ImportBatch" b
       WHERE m."transactionLineId" = l.id AND l."transactionId" = t.id AND t."importBatchId" = b.id
         AND b."orgId" = $1 AND b."sourceSystem" = 'qbo_report'`,
    `DELETE FROM "GrantMembership" m ${batch('m')}`,
    `DELETE FROM "QboReportUpload" WHERE "orgId" = $1`,
    `DELETE FROM "SourceRowVersion" v ${batch('v')}`,
    `DELETE FROM "Transaction" t ${batch('t')}`,
    `DELETE FROM "Party" WHERE "orgId" = $1 AND "sourceSystem" = 'qbo_report'`,
    `DELETE FROM "Account" WHERE "orgId" = $1 AND "sourceSystem" = 'qbo_report'`,
    `DELETE FROM "TrackingClass" WHERE "orgId" = $1 AND "sourceSystem" = 'qbo_report'`,
    `DELETE FROM "TrackingLocation" WHERE "orgId" = $1 AND "sourceSystem" = 'qbo_report'`,
    `DELETE FROM "ImportBatch" WHERE "orgId" = $1 AND "sourceSystem" = 'qbo_report'`,
  ];
  await prisma.$transaction(statements.map((sql) => prisma.$executeRawUnsafe(sql, orgId)));
}
