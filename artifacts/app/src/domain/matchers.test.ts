import { describe, expect, it } from 'vitest';
import { accountNumberInRange, lineMatches, type MatchableLine } from './matchers';

const line: MatchableLine = {
  accountId: 'a1',
  accountNumber: '6110',
  classId: 'c1',
  locationId: 'l1',
  partyId: null,
  txnPartyId: 'p1',
  description: 'Meals for youth',
  memo: 'Community lunch',
  txnDate: new Date('2026-03-15T00:00:00Z'),
  programId: 'YM',
};

describe('crosswalk matcher truth table', () => {
  it.each([
    ['programIds', ['YM'], ['CT']],
    ['accountIds', ['a1'], ['a2']],
    ['classIds', ['c1'], ['c2']],
    ['locationIds', ['l1'], ['l2']],
    ['partyIds', ['p1'], ['p2']],
  ] as const)(
    '%s matches members, ORs alternatives, and treats [] as wildcard',
    (field, yes, no) => {
      expect(lineMatches(line, { [field]: yes })).toBe(true);
      expect(lineMatches(line, { [field]: ['other', ...yes] })).toBe(true);
      expect(lineMatches(line, { [field]: no })).toBe(false);
      expect(lineMatches(line, { [field]: [] })).toBe(true);
    },
  );
  it('ANDs fields and checks the date bounds inclusively', () => {
    expect(lineMatches(line, { programIds: ['YM'], accountIds: ['a2'] })).toBe(false);
    expect(lineMatches(line, { dateFrom: '2026-03-15', dateTo: '2026-03-15' })).toBe(true);
    expect(lineMatches(line, { dateFrom: '2026-03-16' })).toBe(false);
    expect(lineMatches(line, { dateTo: '2026-03-14' })).toBe(false);
  });
  it('compares numeric ranges numerically and non-numeric ones lexicographically', () => {
    expect(accountNumberInRange('9', '8', '10')).toBe(true);
    expect(accountNumberInRange('B2', 'A0', 'C0')).toBe(true);
    expect(accountNumberInRange('D2', 'A0', 'C0')).toBe(false);
    expect(accountNumberInRange(null, '1', '9')).toBe(false);
    expect(lineMatches(line, { accountRange: { from: '6100', to: '6200' } })).toBe(true);
  });
  it('uses transaction party as fallback and searches description and memo case-insensitively', () => {
    expect(lineMatches(line, { partyIds: ['p1'], descriptionContains: 'LUNCH' })).toBe(true);
    expect(lineMatches(line, { descriptionContains: 'YOUTH' })).toBe(true);
    expect(lineMatches({ ...line, partyId: 'p2' }, { partyIds: ['p1'] })).toBe(false);
  });
});
