import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';

type Db = Prisma.TransactionClient | typeof prisma;

export async function recordAudit(
  db: Db,
  input: {
    orgId: string;
    entity: string;
    entityId: string;
    action: 'create' | 'update' | 'delete';
    before?: unknown;
    after?: unknown;
    actor?: string;
  },
): Promise<void> {
  await db.auditEvent.create({
    data: {
      orgId: input.orgId,
      entity: input.entity,
      entityId: input.entityId,
      action: input.action,
      before: input.before === undefined ? undefined : toJson(input.before),
      after: input.after === undefined ? undefined : toJson(input.after),
      actor: input.actor ?? 'local-user',
    },
  });
}

/** Dates → ISO strings so before/after JSON is stable and comparable. */
export function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
