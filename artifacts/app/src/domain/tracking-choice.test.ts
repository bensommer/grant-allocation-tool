import { describe, expect, it } from 'vitest';
import {
  NAME_PREFIX,
  trackingCountSentence,
  trackingFieldsFromForm,
  trackingSelection,
} from './tracking-choice';

const names = {
  classNameOf: (id: string) => (id === 'c1' ? 'Trauma Grants' : null),
  partyNameOf: (id: string) => (id === 'p1' ? '2025-2026 Opioid Grant' : null),
};

describe('trackingSelection (JPH-29 E3)', () => {
  it('reads Class from memberClassIds and carries the rest through', () => {
    const s = trackingSelection({
      memberClassIds: ['c1', 'c2'],
      memberPartyIds: [],
      qboClassName: null,
      qboProjectName: null,
    });
    expect(s).toMatchObject({ choice: 'class', classValue: 'c1', extraClassIds: ['c2'] });
  });
  it('shows a free-text class with no imported match as a name option (Salah)', () => {
    const s = trackingSelection({
      memberClassIds: [],
      memberPartyIds: [],
      qboClassName: 'Trauma Grants',
      qboProjectName: null,
    });
    expect(s).toMatchObject({ choice: 'class', classValue: `${NAME_PREFIX}Trauma Grants` });
  });
  it('is Neither for a crosswalk-only grant', () => {
    expect(trackingSelection(null).choice).toBe('neither');
    expect(
      trackingSelection({
        memberClassIds: [],
        memberPartyIds: [],
        qboClassName: null,
        qboProjectName: null,
      }).choice,
    ).toBe('neither');
  });
});

describe('trackingFieldsFromForm', () => {
  it('Class by id sets memberClassIds and derives qboClassName', () => {
    expect(
      trackingFieldsFromForm({
        choice: 'class',
        classValue: 'c1',
        projectValue: '',
        classOverride: '',
        projectOverride: '',
        extraClassIds: ['c2', 'c1'],
        extraPartyIds: [],
        ...names,
      }),
    ).toEqual({
      memberClassIds: ['c1', 'c2'],
      memberPartyIds: [],
      qboClassName: 'Trauma Grants',
      qboProjectName: null,
    });
  });
  it('a name option keeps memberClassIds untouched (AC8: saving Salah leaves [] as [])', () => {
    expect(
      trackingFieldsFromForm({
        choice: 'class',
        classValue: `${NAME_PREFIX}Trauma Grants`,
        projectValue: '',
        classOverride: '',
        projectOverride: '',
        extraClassIds: [],
        extraPartyIds: [],
        ...names,
      }),
    ).toEqual({
      memberClassIds: [],
      memberPartyIds: [],
      qboClassName: 'Trauma Grants',
      qboProjectName: null,
    });
  });
  it('Override wins over the derived name; Project sets memberPartyIds', () => {
    expect(
      trackingFieldsFromForm({
        choice: 'project',
        classValue: 'c1',
        projectValue: 'p1',
        classOverride: '',
        projectOverride: 'Customer:Opioid',
        extraClassIds: [],
        extraPartyIds: [],
        ...names,
      }),
    ).toEqual({
      memberClassIds: [],
      memberPartyIds: ['p1'],
      qboClassName: null,
      qboProjectName: 'Customer:Opioid',
    });
  });
  it('Neither clears both member lists', () => {
    expect(
      trackingFieldsFromForm({
        choice: 'neither',
        classValue: 'c1',
        projectValue: 'p1',
        classOverride: '',
        projectOverride: '',
        extraClassIds: ['c2'],
        extraPartyIds: ['p2'],
        ...names,
      }),
    ).toEqual({
      memberClassIds: [],
      memberPartyIds: [],
      qboClassName: null,
      qboProjectName: null,
    });
  });
});

describe('trackingCountSentence', () => {
  it('formats with thousands separators and singular / plural', () => {
    expect(trackingCountSentence(1204, 'class')).toBe(
      '1,204 transactions in the books carry this class.',
    );
    expect(trackingCountSentence(1, 'project')).toBe(
      '1 transaction in the books carries this name.',
    );
  });
});
