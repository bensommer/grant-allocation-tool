import { describe, expect, it } from 'vitest';
import { matchesReceived } from './received';

const grant = { matchPartyIds: ['p'], matchClassIds: ['c'], revenueAccountId: null };
const line = { accountId: 'a', accountType: 'Income', classId: null, transactionPartyId: null };
describe('received matching', () => {
  it('matches transaction party or line class', () => {
    expect(matchesReceived(grant, { ...line, transactionPartyId: 'p' })).toBe(true);
    expect(matchesReceived(grant, { ...line, classId: 'c' })).toBe(true);
    expect(matchesReceived(grant, line)).toBe(false);
  });
  it('restricts to income and optional revenue account', () => {
    expect(
      matchesReceived({ ...grant, revenueAccountId: 'other' }, { ...line, classId: 'c' }),
    ).toBe(false);
    expect(matchesReceived({ ...grant, revenueAccountId: 'a' }, { ...line, classId: 'c' })).toBe(
      true,
    );
    expect(matchesReceived(grant, { ...line, accountType: 'Expense', classId: 'c' })).toBe(false);
  });
});
