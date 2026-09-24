import { z } from 'zod';

/** Shared matcher shape for CrosswalkRule and AllocationRule. All fields optional, AND-combined. */
export const matchersSchema = z
  .object({
    programIds: z.array(z.string()).optional(),
    accountIds: z.array(z.string()).optional(),
    accountRange: z.object({ from: z.string(), to: z.string() }).optional(),
    classIds: z.array(z.string()).optional(),
    locationIds: z.array(z.string()).optional(),
    partyIds: z.array(z.string()).optional(),
    descriptionContains: z.string().optional(),
    dateFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    dateTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();

export type Matchers = z.infer<typeof matchersSchema>;

export function parseMatchers(json: unknown): Matchers {
  return matchersSchema.parse(json ?? {});
}

/** Minimal projection of a source line + its resolved program used by matchers. */
export interface MatchableLine {
  accountId: string;
  accountNumber: string | null;
  classId: string | null;
  locationId: string | null;
  partyId: string | null;
  txnPartyId: string | null;
  description: string | null;
  memo: string | null;
  txnDate: Date;
  programId: string | null;
}

function inSet(value: string | null, set: string[] | undefined): boolean {
  if (!set || set.length === 0) return true;
  return value !== null && set.includes(value);
}

/**
 * Account number ranges compare numerically when both are numeric, otherwise
 * lexicographically. A line with no account number never matches a range.
 */
export function accountNumberInRange(num: string | null, from: string, to: string): boolean {
  if (num === null || num === '') return false;
  const n = Number(num);
  const f = Number(from);
  const t = Number(to);
  if (Number.isFinite(n) && Number.isFinite(f) && Number.isFinite(t)) return n >= f && n <= t;
  return num >= from && num <= to;
}

export function lineMatches(line: MatchableLine, m: Matchers): boolean {
  if (!inSet(line.programId, m.programIds)) return false;
  if (!inSet(line.accountId, m.accountIds)) return false;
  if (
    m.accountRange &&
    !accountNumberInRange(line.accountNumber, m.accountRange.from, m.accountRange.to)
  ) {
    return false;
  }
  if (!inSet(line.classId, m.classIds)) return false;
  if (!inSet(line.locationId, m.locationIds)) return false;
  if (m.partyIds && m.partyIds.length > 0) {
    const party = line.partyId ?? line.txnPartyId;
    if (party === null || !m.partyIds.includes(party)) return false;
  }
  if (m.descriptionContains && m.descriptionContains.trim() !== '') {
    const needle = m.descriptionContains.toLowerCase();
    const hay = `${line.description ?? ''}\n${line.memo ?? ''}`.toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  const iso = line.txnDate.toISOString().slice(0, 10);
  if (m.dateFrom && iso < m.dateFrom) return false;
  if (m.dateTo && iso > m.dateTo) return false;
  return true;
}

export function isEmptyMatchers(m: Matchers): boolean {
  return Object.values(m).every(
    (v) => v === undefined || (Array.isArray(v) && v.length === 0) || v === '',
  );
}
