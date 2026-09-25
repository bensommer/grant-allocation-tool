/**
 * Correcting entries (JPH-22, JPH-19 §6 G) — pure.
 *
 * A draft is a balanced journal entry (Σ debits = Σ credits, to the cent) that a
 * human posts in QuickBooks. Two builders:
 *
 * - reclass (D1-B): lines excluded from a grant are moved off it — per original
 *   account, credit the account on the grant's class/project and debit the same
 *   account on the org's default destination.
 * - true-up: the booked − charged variance of an effort schedule is moved
 *   between the grant and the default destination on one payroll account.
 *
 * The balance check lives here so it cannot be bypassed by any UI.
 */
import { normalizeText } from './matchers';
import { formatCents } from './money';

/**
 * Where a journal line lands in QuickBooks: a class and/or a project (customer).
 * Ids point at ledger rows when they exist; the names are what the export
 * carries (the QuickBooks importer matches by name), so a grant coded with a
 * class / project that is not a ledger row is still exportable.
 */
export interface Destination {
  classId: string | null;
  partyId: string | null;
  className: string | null;
  partyName: string | null;
}

/** True when the destination names at least a class or a project. */
export function isCoded(d: Destination): boolean {
  return !!(d.className?.trim() || d.partyName?.trim());
}

export class GrantCodingMissingError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'GrantCodingMissingError';
  }
}

export interface EntryLineDraft {
  accountId: string;
  classId: string | null;
  partyId: string | null;
  className: string | null;
  partyName: string | null;
  /** True for the lines that land on the grant's class/project. */
  grantSide: boolean;
  debitCents: number;
  creditCents: number;
  description: string;
}

export class UnbalancedEntryError extends Error {
  constructor(
    public readonly debitCents: number,
    public readonly creditCents: number,
    detail?: string,
  ) {
    super(
      detail ??
        `Correcting entry does not balance: debits ${formatCents(debitCents)} ≠ credits ${formatCents(creditCents)}`,
    );
    this.name = 'UnbalancedEntryError';
  }
}

export function entryTotals(lines: ReadonlyArray<Pick<EntryLineDraft, 'debitCents' | 'creditCents'>>) {
  let debitCents = 0;
  let creditCents = 0;
  for (const l of lines) {
    debitCents += l.debitCents;
    creditCents += l.creditCents;
  }
  return { debitCents, creditCents };
}

/**
 * Throws UnbalancedEntryError unless every line is a well-formed single-sided
 * integer amount and Σ debits = Σ credits > 0.
 */
export function assertBalanced(lines: ReadonlyArray<EntryLineDraft>): void {
  if (lines.length < 2)
    throw new UnbalancedEntryError(0, 0, 'A correcting entry needs at least two lines');
  for (const l of lines) {
    if (!Number.isInteger(l.debitCents) || !Number.isInteger(l.creditCents))
      throw new UnbalancedEntryError(0, 0, 'Amounts must be integer cents');
    if (l.debitCents < 0 || l.creditCents < 0)
      throw new UnbalancedEntryError(0, 0, 'Debits and credits cannot be negative');
    if ((l.debitCents > 0) === (l.creditCents > 0))
      throw new UnbalancedEntryError(0, 0, 'Each line must be either a debit or a credit');
  }
  const { debitCents, creditCents } = entryTotals(lines);
  if (debitCents !== creditCents) throw new UnbalancedEntryError(debitCents, creditCents);
}

/** Net effect on the grant's books (debit − credit of grant-side lines), in cents. */
export function grantSideCents(lines: ReadonlyArray<EntryLineDraft>): number {
  return lines
    .filter((l) => l.grantSide)
    .reduce((s, l) => s + l.debitCents - l.creditCents, 0);
}

/** Pair of lines moving `amountCents` (signed: positive = off the grant) between grant and destination. */
function movePair(
  accountId: string,
  amountCents: number,
  grant: Destination,
  destination: Destination,
  description: string,
): EntryLineDraft[] {
  if (!isCoded(grant))
    throw new GrantCodingMissingError(
      'The grant has no QuickBooks class or project; the grant side of the entry cannot be coded',
    );
  if (!isCoded(destination))
    throw new GrantCodingMissingError('The destination has no QuickBooks class or project');
  const abs = Math.abs(amountCents);
  const offGrant = amountCents > 0;
  return [
    {
      accountId,
      classId: grant.classId,
      partyId: grant.partyId,
      className: grant.className,
      partyName: grant.partyName,
      grantSide: true,
      debitCents: offGrant ? 0 : abs,
      creditCents: offGrant ? abs : 0,
      description,
    },
    {
      accountId,
      classId: destination.classId,
      partyId: destination.partyId,
      className: destination.className,
      partyName: destination.partyName,
      grantSide: false,
      debitCents: offGrant ? abs : 0,
      creditCents: offGrant ? 0 : abs,
      description,
    },
  ];
}

export interface ExcludedLineRef {
  accountId: string;
  accountName: string;
  txnDate: Date;
  amountCents: number;
}

/**
 * D1-B reclass. Per original account (in first-seen order): credit the account
 * on the grant for the excluded lines' total and debit it on the destination.
 * A net-negative account total flips the sides. Zero-net accounts are skipped.
 */
export function buildReclassLines(input: {
  code: string;
  excluded: ReadonlyArray<ExcludedLineRef>;
  grant: Destination;
  destination: Destination;
}): EntryLineDraft[] {
  const byAccount = new Map<string, { name: string; total: number; lines: ExcludedLineRef[] }>();
  for (const l of input.excluded) {
    const acc = byAccount.get(l.accountId) ?? { name: l.accountName, total: 0, lines: [] };
    acc.total += l.amountCents;
    acc.lines.push(l);
    byAccount.set(l.accountId, acc);
  }
  const out: EntryLineDraft[] = [];
  for (const [accountId, acc] of byAccount) {
    if (acc.total === 0) continue;
    const detail = [...acc.lines]
      .sort((a, b) => a.txnDate.getTime() - b.txnDate.getTime())
      .map((l) => `${isoDate(l.txnDate)} ${formatCents(l.amountCents)}`)
      .join('; ');
    out.push(
      ...movePair(
        accountId,
        acc.total,
        input.grant,
        input.destination,
        `${input.code} reclass ${acc.name}: ${detail}`,
      ),
    );
  }
  if (out.length === 0)
    throw new UnbalancedEntryError(0, 0, 'The excluded lines net to zero; nothing to reclass');
  assertBalanced(out);
  return out;
}

/**
 * True-up. variance = booked − charged; a positive variance is moved off the
 * grant (credit grant, debit destination), a negative one onto it.
 */
export function buildTrueUpLines(input: {
  code: string;
  varianceCents: number;
  accountId: string;
  accountName: string;
  personLabel: string;
  grant: Destination;
  destination: Destination;
}): EntryLineDraft[] {
  if (!Number.isInteger(input.varianceCents) || input.varianceCents === 0)
    throw new UnbalancedEntryError(0, 0, 'Variance is zero; nothing to true up');
  const lines = movePair(
    input.accountId,
    input.varianceCents,
    input.grant,
    input.destination,
    `${input.code} true-up ${input.accountName}: ${input.personLabel} booked − charged ${formatCents(input.varianceCents)}`,
  );
  assertBalanced(lines);
  return lines;
}

/**
 * True when `text` carries `code` as a whole token: `GAT-0001` is found in
 * "GAT-0001 true-up …" or "posted (GAT-0001)" but not in "GAT-00010" or
 * "XGAT-0001". Compared on normalized text (case-insensitive, dashes flattened).
 * Used by posted detection and by posted-line loading, so both agree.
 */
export function carriesCode(text: string | null | undefined, code: string): boolean {
  if (!text) return false;
  const escaped = normalizeText(code).replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}(?![a-z0-9])`).test(normalizeText(text));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
