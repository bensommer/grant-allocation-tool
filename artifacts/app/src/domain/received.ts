export type RevenueMatcher = {
  matchPartyIds: string[];
  matchClassIds: string[];
  revenueAccountId: string | null;
};

/** Income amounts in the source mirror increase income when positive (credit). */
export function matchesReceived(
  grant: RevenueMatcher,
  line: {
    accountId: string;
    accountType: string;
    classId: string | null;
    transactionPartyId: string | null;
    /** line-level party (e.g. a deposit line) takes precedence over the header party */
    linePartyId?: string | null;
  },
) {
  return (
    (line.accountType === 'Income' || line.accountType === 'OtherIncome') &&
    (!grant.revenueAccountId || grant.revenueAccountId === line.accountId) &&
    (grant.matchPartyIds.includes(line.linePartyId ?? line.transactionPartyId ?? '') ||
      grant.matchClassIds.includes(line.classId ?? ''))
  );
}
