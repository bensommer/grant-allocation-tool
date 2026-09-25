import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { prisma as defaultPrisma } from '@/lib/db';
import { toJson } from '@/lib/audit';
import {
  type DataSource,
  type DateRange,
  type ImportError,
  type SourceAccount,
  type SourceClass,
  type SourceLocation,
  type SourceParty,
  type SourceTransaction,
} from '@/datasource/types';
import { collectErrors } from '@/datasource/csv/adapter';
import { formatCents } from '@/domain/money';
import {
  addImportScopeMemberships,
  supersedeMemberships,
  syncRuleMemberships,
} from '@/services/grant-membership';

export type EntityName = 'accounts' | 'classes' | 'locations' | 'parties' | 'transactions';
export interface BucketCounts {
  new: number;
  changed: number;
  unchanged: number;
  deleted: number;
}
export type ImportCounts = Record<EntityName, BucketCounts> & { lines: number };

export interface ImportResult {
  batchId: string;
  status: 'succeeded' | 'failed';
  counts: ImportCounts;
  errors: ImportError[];
}

const emptyBucket = (): BucketCounts => ({ new: 0, changed: 0, unchanged: 0, deleted: 0 });
const emptyCounts = (): ImportCounts => ({
  accounts: emptyBucket(),
  classes: emptyBucket(),
  locations: emptyBucket(),
  parties: emptyBucket(),
  transactions: emptyBucket(),
  lines: 0,
});

/** Stable content hash of the normalized DTO (key order fixed by JSON.stringify on a sorted copy). */
export function contentHash(value: unknown): string {
  return createHash('sha256')
    .update(stableStringify(normalizeSource(value)))
    .digest('hex');
}
export function normalizeSource(value: unknown): unknown {
  if (typeof value === 'string') return value.trim();
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) return value.map(normalizeSource);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        key === 'amount' && typeof entry === 'string'
          ? normalizeAmount(entry)
          : normalizeSource(entry),
      ]),
    );
  return value;
}
function normalizeAmount(raw: string): number | string {
  const normalized = raw.trim().replace(/,/g, '');
  if (!/^[+-]?\d+(\.\d+)?$/.test(normalized)) return raw.trim();
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > 3 || (fraction.length === 3 && fraction[2] !== '0')) return raw.trim();
  const cents = Math.abs(Number(whole)) * 100 + Number(fraction.slice(0, 2).padEnd(2, '0'));
  return normalized.startsWith('-') ? -cents : cents;
}
function stableStringify(v: unknown): string {
  if (v instanceof Date) return JSON.stringify(v.toISOString().slice(0, 10));
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Debit-normal accounts keep debit positive; credit-normal accounts flip. */
export function naturalSign(
  accountType: SourceAccount['type'],
  posting: 'debit' | 'credit',
): 1 | -1 {
  const debitNormal =
    accountType === 'Asset' ||
    accountType === 'Expense' ||
    accountType === 'COGS' ||
    accountType === 'OtherExpense';
  const isDebit = posting === 'debit';
  return debitNormal === isDebit ? 1 : -1;
}

/**
 * Report imports (JPH-20) are scoped to one grant and the report's date range.
 * Only transactions that are currently members of that grant and dated inside
 * the range can be marked removed; everything else in the mirror is untouched.
 */
export interface ImportScope {
  grantId: string;
  dateFrom: Date;
  dateTo: Date;
}

export interface ImportServiceOptions {
  prisma?: PrismaClient;
  /** When true (default for CSV), rows absent from the source are soft-deleted. */
  fullRange?: boolean;
  scope?: ImportScope;
}

/**
 * ImportService.run — adapter-agnostic upsert into the source mirror.
 *
 * 1. Drain the adapter (all DTOs validated by zod inside the adapter).
 * 2. Referential validation against batch + existing mirror.
 * 3. If any error was collected → batch marked failed, nothing else written.
 * 4. Otherwise one DB transaction: per-entity upsert with change detection
 *    (new / changed / unchanged / deleted), SourceRowVersion history for
 *    changed + deleted rows, soft-delete for full-range imports.
 */
export async function runImport(
  orgId: string,
  source: DataSource,
  range: DateRange,
  opts: ImportServiceOptions = {},
): Promise<ImportResult> {
  const prisma = opts.prisma ?? defaultPrisma;
  const scope = opts.scope ?? null;
  const fullRange = scope ? false : (opts.fullRange ?? source.kind === 'csv');
  const { sink, errors } = collectErrors();
  const errorFile = source.fileName ?? 'transactions.csv';
  const checksums = source.checksums ? source.checksums() : [];
  const reportMeta = (source as { reportMeta?: Record<string, unknown> }).reportMeta ?? {};
  // Adapters constructed by callers may already hold their own sink; we also
  // accept adapter-level errors surfaced through `errors` property duck-typing.
  const adapterErrors = (source as { errors?: ImportError[] }).errors;

  const batch = await prisma.importBatch.create({
    data: {
      orgId,
      sourceSystem: source.kind,
      rangeFrom: range.from,
      rangeTo: range.to,
      fullRange,
      fileHashes: source.fileHashes ? await source.fileHashes() : {},
      scopeGrantId: scope?.grantId ?? null,
      scopeDateFrom: scope?.dateFrom ?? null,
      scopeDateTo: scope?.dateTo ?? null,
      checksums: toJson(checksums),
      reportMeta: toJson(reportMeta),
    },
  });
  if (scope) {
    const grant = await prisma.grant.findFirst({ where: { id: scope.grantId, orgId } });
    if (!grant)
      sink.push({
        file: errorFile,
        row: null,
        column: null,
        code: 'unknown_grant',
        message: `Grant ${scope.grantId} does not exist in this organization`,
      });
  }
  for (const c of checksums) {
    if (c.passed) continue;
    sink.push({
      file: errorFile,
      row: c.row,
      column: 'Amount',
      code: 'checksum_mismatch',
      message: `${c.label} (row ${c.row}): the report says ${formatCents(c.expectedCents)} but the lines under it add up to ${formatCents(c.actualCents)}`,
    });
  }

  const descriptor = await source.describe();
  const accounts: SourceAccount[] = [];
  const classes: SourceClass[] = [];
  const locations: SourceLocation[] = [];
  const parties: SourceParty[] = [];
  const transactions: SourceTransaction[] = [];
  const trialBalance = source.fetchTrialBalance ? await source.fetchTrialBalance() : [];
  for await (const a of source.fetchAccounts()) accounts.push(a);
  for await (const c of source.fetchClasses()) classes.push(c);
  for await (const l of source.fetchLocations()) locations.push(l);
  for await (const p of source.fetchParties()) parties.push(p);
  for await (const t of source.fetchTransactions(range)) transactions.push(t);

  // --- referential validation -------------------------------------------
  const sys = source.kind;
  const existing = {
    accounts: await prisma.account.findMany({
      where: { orgId, sourceSystem: sys },
      select: { externalId: true, type: true },
    }),
    classes: await prisma.trackingClass.findMany({
      where: { orgId, sourceSystem: sys },
      select: { externalId: true },
    }),
    locations: await prisma.trackingLocation.findMany({
      where: { orgId, sourceSystem: sys },
      select: { externalId: true },
    }),
    parties: await prisma.party.findMany({
      where: { orgId, sourceSystem: sys },
      select: { externalId: true },
    }),
  };
  const accountTypes = new Map<string, SourceAccount['type']>();
  for (const a of existing.accounts) accountTypes.set(a.externalId, a.type);
  for (const a of accounts) accountTypes.set(a.externalId, a.type);
  const known = {
    accounts: new Set([
      ...existing.accounts.map((a) => a.externalId),
      ...accounts.map((a) => a.externalId),
    ]),
    classes: new Set([
      ...existing.classes.map((a) => a.externalId),
      ...classes.map((a) => a.externalId),
    ]),
    locations: new Set([
      ...existing.locations.map((a) => a.externalId),
      ...locations.map((a) => a.externalId),
    ]),
    parties: new Set([
      ...existing.parties.map((a) => a.externalId),
      ...parties.map((a) => a.externalId),
    ]),
  };
  const unknownRef = (column: string, id: string, txn: string) =>
    sink.push({
      file: errorFile,
      row: null,
      column,
      code: 'unknown_reference',
      message: `Transaction ${txn}: ${column} "${id}" does not exist in this import or the mirror`,
    });
  for (const a of accounts) {
    if (a.parentExternalId && !known.accounts.has(a.parentExternalId)) {
      sink.push({
        file: 'accounts.csv',
        row: null,
        column: 'parent_external_id',
        code: 'unknown_reference',
        message: `Account ${a.externalId}: parent "${a.parentExternalId}" not found`,
      });
    }
  }
  for (const t of transactions) {
    if (t.partyExternalId && !known.parties.has(t.partyExternalId))
      unknownRef('txn_party_external_id', t.partyExternalId, t.externalId);
    if (t.paymentAccountExternalId && !known.accounts.has(t.paymentAccountExternalId))
      unknownRef('payment_account_external_id', t.paymentAccountExternalId, t.externalId);
    for (const l of t.lines) {
      if (!known.accounts.has(l.accountExternalId))
        unknownRef('account_external_id', l.accountExternalId, t.externalId);
      if (l.classExternalId && !known.classes.has(l.classExternalId))
        unknownRef('class_external_id', l.classExternalId, t.externalId);
      if (l.locationExternalId && !known.locations.has(l.locationExternalId))
        unknownRef('location_external_id', l.locationExternalId, t.externalId);
      if (l.partyExternalId && !known.parties.has(l.partyExternalId))
        unknownRef('line_party_external_id', l.partyExternalId, t.externalId);
    }
  }

  const allErrors = [...(adapterErrors ?? []), ...errors];
  // Attach row numbers from adapter errors of the same code/column when ours lack them.
  if (allErrors.length > 0) {
    await prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        errors: toJson(allErrors),
        counts: toJson(emptyCounts()),
      },
    });
    return { batchId: batch.id, status: 'failed', counts: emptyCounts(), errors: allErrors };
  }

  // --- persist ------------------------------------------------------------
  const counts = emptyCounts();
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.org.update({
          where: { id: orgId },
          data: {
            name: descriptor.companyName,
            fiscalYearStartMonth: descriptor.fiscalYearStartMonth,
            currency: descriptor.currency,
          },
        });

        const version = async (
          entity: string,
          externalId: string,
          payload: unknown,
          hash: string,
        ) => {
          const last = await tx.sourceRowVersion.findFirst({
            where: { orgId, entity, externalId },
            orderBy: { version: 'desc' },
            select: { version: true },
          });
          await tx.sourceRowVersion.create({
            data: {
              orgId,
              entity,
              externalId,
              version: (last?.version ?? 0) + 1,
              hash,
              payload: toJson(payload),
              importBatchId: batch.id,
            },
          });
        };

        // Generic upsert for the four flat entities.
        async function upsertFlat<T extends { externalId: string }>(
          entity: EntityName,
          modelName: 'account' | 'trackingClass' | 'trackingLocation' | 'party',
          rows: T[],
          toData: (r: T) => Record<string, unknown>,
        ) {
          const delegate = tx[modelName] as unknown as {
            findMany(
              args: unknown,
            ): Promise<
              Array<{ id: string; externalId: string; contentHash: string; deletedAt: Date | null }>
            >;
            create(args: unknown): Promise<unknown>;
            update(args: unknown): Promise<unknown>;
            findUnique(args: unknown): Promise<unknown>;
          };
          const current = await delegate.findMany({
            where: { orgId, sourceSystem: sys },
            select: { id: true, externalId: true, contentHash: true, deletedAt: true },
          });
          const byExt = new Map(current.map((c) => [c.externalId, c]));
          const seen = new Set<string>();
          for (const r of rows) {
            seen.add(r.externalId);
            const hash = contentHash(r);
            const cur = byExt.get(r.externalId);
            const data = toData(r);
            if (!cur) {
              await delegate.create({
                data: {
                  orgId,
                  sourceSystem: sys,
                  externalId: r.externalId,
                  importBatchId: batch.id,
                  contentHash: hash,
                  ...data,
                },
              });
              counts[entity].new++;
            } else if (cur.contentHash !== hash || cur.deletedAt) {
              const before = await delegate.findUnique({ where: { id: cur.id } });
              await version(entity, r.externalId, before, cur.contentHash);
              await delegate.update({
                where: { id: cur.id },
                data: {
                  ...data,
                  contentHash: hash,
                  deletedAt: null,
                  importBatchId: batch.id,
                  importedAt: new Date(),
                },
              });
              counts[entity].changed++;
            } else {
              counts[entity].unchanged++;
            }
          }
          if (fullRange) {
            for (const cur of current) {
              if (!seen.has(cur.externalId) && !cur.deletedAt) {
                const before = await delegate.findUnique({ where: { id: cur.id } });
                await version(entity, cur.externalId, before, cur.contentHash);
                await delegate.update({ where: { id: cur.id }, data: { deletedAt: new Date() } });
                counts[entity].deleted++;
              }
            }
          }
        }

        await upsertFlat('accounts', 'account', accounts, (a) => ({
          number: a.number,
          name: a.name,
          type: a.type,
          detailType: a.detailType,
          parentExternalId: a.parentExternalId,
          active: a.active,
        }));
        await upsertFlat('classes', 'trackingClass', classes, (c) => ({
          name: c.name,
          parentExternalId: c.parentExternalId,
          active: c.active,
        }));
        await upsertFlat('locations', 'trackingLocation', locations, (l) => ({
          name: l.name,
          active: l.active,
        }));
        await upsertFlat('parties', 'party', parties, (p) => ({
          kind: p.kind,
          displayName: p.displayName,
          parentExternalId: p.parentExternalId,
        }));

        // Resolve external → internal ids for line FKs.
        const idMap = async (model: 'account' | 'trackingClass' | 'trackingLocation' | 'party') => {
          const delegate = tx[model] as unknown as {
            findMany(args: unknown): Promise<Array<{ id: string; externalId: string }>>;
          };
          const rows = await delegate.findMany({
            where: { orgId, sourceSystem: sys },
            select: { id: true, externalId: true },
          });
          return new Map(rows.map((r) => [r.externalId, r.id]));
        };
        const accountIds = await idMap('account');
        const classIds = await idMap('trackingClass');
        const locationIds = await idMap('trackingLocation');
        const partyIds = await idMap('party');

        const currentTxns = await tx.transaction.findMany({
          where: {
            orgId,
            sourceSystem: sys,
          },
          select: {
            id: true,
            externalId: true,
            contentHash: true,
            deletedAt: true,
            txnDate: true,
            matchKey: true,
          },
        });
        const txnByExt = new Map(currentTxns.map((t) => [t.externalId, t]));
        const seenTxn = new Set<string>(transactions.map((t) => t.externalId));

        // Scoped imports: only transactions this grant's own earlier reports
        // brought in (active import_scope membership) inside the date range are
        // candidates for "removed". Class/project rule memberships do not count:
        // they may point at lines another grant's report owns.
        let removable: Set<string> | null = null;
        if (scope) {
          const rows = await tx.transaction.findMany({
            where: {
              orgId,
              sourceSystem: sys,
              deletedAt: null,
              txnDate: { gte: scope.dateFrom, lte: scope.dateTo },
              lines: {
                some: {
                  memberships: {
                    some: { grantId: scope.grantId, via: 'import_scope', supersededAt: null },
                  },
                },
              },
            },
            select: { externalId: true },
          });
          removable = new Set(rows.map((r) => r.externalId));
        }
        const isRemovable = (cur: (typeof currentTxns)[number]) =>
          !seenTxn.has(cur.externalId) &&
          !cur.deletedAt &&
          (fullRange || (removable?.has(cur.externalId) ?? false));

        // Pair a vanished row with a new row sharing a matchKey (amount edited
        // at the source) so the mirror records one change, not removed + new.
        const paired = new Map<string, (typeof currentTxns)[number]>();
        {
          const vanished = new Map<string, Array<(typeof currentTxns)[number]>>();
          for (const cur of currentTxns)
            if (cur.matchKey && isRemovable(cur))
              (
                vanished.get(cur.matchKey) ?? vanished.set(cur.matchKey, []).get(cur.matchKey)!
              ).push(cur);
          const arrived = new Map<string, SourceTransaction[]>();
          for (const t of transactions)
            if (t.matchKey && !txnByExt.has(t.externalId))
              (arrived.get(t.matchKey) ?? arrived.set(t.matchKey, []).get(t.matchKey)!).push(t);
          for (const [key, news] of arrived) {
            const olds = vanished.get(key);
            if (olds && olds.length === 1 && news.length === 1) {
              paired.set(news[0]!.externalId, olds[0]!);
              seenTxn.add(olds[0]!.externalId);
            }
          }
        }
        const importedTxnIds: string[] = [];
        const removedLineIds: string[] = [];
        const locks = await tx.periodLock.findMany({ where: { orgId } });
        const affectedLocks = new Set<string>();
        const lockNewIds: Record<string, string[]> = {};
        const flagLocks = (date: Date, newExternalId?: string) => {
          for (const lock of locks)
            if (date >= lock.periodFrom && date <= lock.periodTo) {
              affectedLocks.add(lock.id);
              if (newExternalId) (lockNewIds[lock.id] ??= []).push(newExternalId);
            }
        };

        for (const t of transactions) {
          const hash = contentHash(t);
          const cur = txnByExt.get(t.externalId) ?? paired.get(t.externalId);
          const lineData: Prisma.TransactionLineCreateManyInput[] = t.lines.map((l) => {
            const type = accountTypes.get(l.accountExternalId)!;
            return {
              orgId,
              transactionId: '',
              lineNumber: l.lineNumber,
              accountId: accountIds.get(l.accountExternalId)!,
              classId: l.classExternalId ? classIds.get(l.classExternalId)! : null,
              locationId: l.locationExternalId ? locationIds.get(l.locationExternalId)! : null,
              partyId: l.partyExternalId ? partyIds.get(l.partyExternalId)! : null,
              description: l.description,
              amountCents: naturalSign(type, l.postingType) * l.amountCents,
              postingType: l.postingType,
            };
          });
          const totalCents =
            t.txnType === 'JournalEntry'
              ? t.lines
                  .filter((l) => l.postingType === 'debit')
                  .reduce((a, l) => a + l.amountCents, 0)
              : t.lines.reduce((a, l) => a + l.amountCents, 0);
          const header = {
            txnType: t.txnType,
            txnDate: t.txnDate,
            docNumber: t.docNumber,
            memo: t.memo,
            partyId: t.partyExternalId ? partyIds.get(t.partyExternalId)! : null,
            paymentAccountExternalId: t.paymentAccountExternalId,
            totalCents,
            matchKey: t.matchKey ?? null,
          };
          if (!cur) {
            flagLocks(t.txnDate, t.externalId);
            const created = await tx.transaction.create({
              data: {
                orgId,
                sourceSystem: sys,
                externalId: t.externalId,
                importBatchId: batch.id,
                contentHash: hash,
                ...header,
              },
            });
            await tx.transactionLine.createMany({
              data: lineData.map((l) => ({ ...l, transactionId: created.id })),
            });
            importedTxnIds.push(created.id);
            counts.transactions.new++;
          } else if (cur.contentHash !== hash || cur.deletedAt) {
            flagLocks(cur.txnDate);
            flagLocks(t.txnDate);
            const before = await tx.transaction.findUnique({
              where: { id: cur.id },
              include: { lines: { orderBy: { lineNumber: 'asc' } } },
            });
            await version('transactions', t.externalId, before, cur.contentHash);
            // Lines referenced by a closed run are protected by FK Restrict on AllocatedLine;
            // replace in place where possible (same lineNumber) to keep ids stable.
            const existingLines = await tx.transactionLine.findMany({
              where: { transactionId: cur.id },
            });
            const byNo = new Map(existingLines.map((l) => [l.lineNumber, l]));
            for (const l of lineData) {
              const ex = byNo.get(l.lineNumber);
              if (ex) {
                await tx.transactionLine.update({
                  where: { id: ex.id },
                  data: {
                    orgId: l.orgId,
                    lineNumber: l.lineNumber,
                    accountId: l.accountId,
                    classId: l.classId,
                    locationId: l.locationId,
                    partyId: l.partyId,
                    description: l.description,
                    amountCents: l.amountCents,
                    postingType: l.postingType,
                    deletedAt: null,
                  },
                });
                byNo.delete(l.lineNumber);
              } else {
                await tx.transactionLine.create({ data: { ...l, transactionId: cur.id } });
              }
            }
            for (const leftover of byNo.values()) {
              await tx.transactionLine.update({
                where: { id: leftover.id },
                data: { deletedAt: new Date() },
              });
              removedLineIds.push(leftover.id);
            }
            await tx.transaction.update({
              where: { id: cur.id },
              data: {
                ...header,
                externalId: t.externalId,
                contentHash: hash,
                deletedAt: null,
                importBatchId: batch.id,
                importedAt: new Date(),
              },
            });
            importedTxnIds.push(cur.id);
            counts.transactions.changed++;
          } else {
            importedTxnIds.push(cur.id);
            counts.transactions.unchanged++;
          }
          counts.lines += t.lines.length;
        }
        for (const cur of currentTxns) {
          if (isRemovable(cur)) {
            flagLocks(cur.txnDate);
            const before = await tx.transaction.findUnique({
              where: { id: cur.id },
              include: { lines: true },
            });
            for (const l of before?.lines ?? []) removedLineIds.push(l.id);
            counts.transactions.deleted++;
            // A transaction another grant's report still holds is shared; this
            // grant only drops its membership and the mirror row stays live.
            const heldElsewhere =
              scope &&
              (await tx.grantMembership.count({
                where: {
                  line: { transactionId: cur.id },
                  grantId: { not: scope.grantId },
                  via: 'import_scope',
                  supersededAt: null,
                },
              })) > 0;
            if (heldElsewhere) continue;
            await version('transactions', cur.externalId, before, cur.contentHash);
            await tx.transaction.update({ where: { id: cur.id }, data: { deletedAt: new Date() } });
          }
        }

        if (scope) {
          await addImportScopeMemberships(tx, orgId, scope.grantId, batch.id, importedTxnIds);
          await supersedeMemberships(tx, scope.grantId, removedLineIds);
        }
        // Grants with member classes / projects pick up any new lines.
        await syncRuleMemberships(tx, orgId);

        const changedAnything = (
          ['accounts', 'classes', 'locations', 'parties', 'transactions'] as const
        ).some((e) => counts[e].new + counts[e].changed + counts[e].deleted > 0);
        if (changedAnything) {
          await tx.computeRun.updateMany({
            where: { orgId, isCurrent: true },
            data: { stale: true },
          });
        }

        await tx.importBatch.update({
          where: { id: batch.id },
          data: {
            status: 'succeeded',
            finishedAt: new Date(),
            counts: toJson({
              ...counts,
              lockIds: [...affectedLocks],
              lockNewIds,
              trialBalance,
            }),
            errors: [],
          },
        });
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const fatal: ImportError[] = [
      { file: '', row: null, column: null, code: 'internal_error', message },
    ];
    await prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        errors: toJson(fatal),
        counts: toJson(emptyCounts()),
      },
    });
    return { batchId: batch.id, status: 'failed', counts: emptyCounts(), errors: fatal };
  }

  return { batchId: batch.id, status: 'succeeded', counts, errors: [] };
}

/** Convenience for CLI/tests: import everything the source has. */
export const FULL_RANGE: DateRange = {
  from: new Date('1900-01-01T00:00:00Z'),
  to: new Date('2999-12-31T00:00:00Z'),
};
