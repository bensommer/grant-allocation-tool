import { pick, pickList, type FormState } from '@/lib/forms';
import type { Matchers } from '@/domain/matchers';

export function previewInputMatchers(state: FormState): Matchers {
  const from = pick(state, 'accountFrom', '');
  const to = pick(state, 'accountTo', '');
  const dateFrom = pick(state, 'dateFrom', '');
  const dateTo = pick(state, 'dateTo', '');
  return {
    programIds: pickList(state, 'programIds', []),
    accountIds: pickList(state, 'accountIds', []),
    classIds: pickList(state, 'classIds', []),
    locationIds: pickList(state, 'locationIds', []),
    partyIds: pickList(state, 'partyIds', []),
    ...(from && to ? { accountRange: { from, to } } : {}),
    descriptionContains: pick(state, 'descriptionContains', ''),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  };
}
