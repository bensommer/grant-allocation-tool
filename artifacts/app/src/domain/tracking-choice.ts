/**
 * "How QuickBooks tracks this grant" (JPH-29 E3): one choice — Class, Project / customer, or
 * Neither — read from and written to the grant's existing fields. Pure; the form and the wizard
 * both go through here so the two blocks cannot drift.
 *
 * Stored fields:
 *  - memberClassIds / memberPartyIds: the class / name whose transactions belong to the grant
 *    (Phase 0's trackingMode flips to `membership` when either is set).
 *  - qboClassName / qboProjectName: the free-text name used on the grant side of correcting
 *    entries. Derived from the selection; the "Override" disclosure lets the CPA type another.
 *
 * A grant whose books have no class / name matching its free-text field (e.g. a pilot grant
 * coded before the class list was imported) is shown as that name with a "not in the imported
 * books" note; saving keeps memberClassIds / memberPartyIds exactly as they were.
 */
export type TrackingChoice = 'class' | 'project' | 'neither';

/** Select value for a free-text name that is not one of the imported classes / names. */
export const NAME_PREFIX = 'name:';

export interface TrackingFields {
  memberClassIds: string[];
  memberPartyIds: string[];
  qboClassName: string | null;
  qboProjectName: string | null;
}

export interface TrackingSelection {
  choice: TrackingChoice;
  /** Select value under the Class radio: a class id, `name:<free text>`, or ''. */
  classValue: string;
  /** Select value under the Project / customer radio: a party id, `name:<free text>`, or ''. */
  projectValue: string;
  /**
   * Further member ids beyond the one the select shows — the rest of the chosen list and the
   * whole of the other one (a grant may be tracked by a class *and* a customer). Carried
   * through unchanged so an edit that does not touch this block never drops memberships.
   */
  extraClassIds: string[];
  extraPartyIds: string[];
}

export function trackingSelection(g: TrackingFields | null): TrackingSelection {
  const none: TrackingSelection = {
    choice: 'neither',
    classValue: '',
    projectValue: '',
    extraClassIds: [],
    extraPartyIds: [],
  };
  if (!g) return none;
  if (g.memberClassIds.length > 0)
    return {
      ...none,
      choice: 'class',
      classValue: g.memberClassIds[0]!,
      extraClassIds: g.memberClassIds.slice(1),
      extraPartyIds: g.memberPartyIds,
      projectValue: g.qboProjectName ? NAME_PREFIX + g.qboProjectName : '',
    };
  if (g.memberPartyIds.length > 0)
    return {
      ...none,
      choice: 'project',
      projectValue: g.memberPartyIds[0]!,
      extraPartyIds: g.memberPartyIds.slice(1),
      extraClassIds: g.memberClassIds,
      classValue: g.qboClassName ? NAME_PREFIX + g.qboClassName : '',
    };
  if (g.qboClassName)
    return {
      ...none,
      choice: 'class',
      classValue: NAME_PREFIX + g.qboClassName,
      projectValue: g.qboProjectName ? NAME_PREFIX + g.qboProjectName : '',
    };
  if (g.qboProjectName)
    return { ...none, choice: 'project', projectValue: NAME_PREFIX + g.qboProjectName };
  return none;
}

export interface TrackingFormInput {
  choice: TrackingChoice;
  classValue: string;
  projectValue: string;
  /** Override disclosure texts ('' = none). */
  classOverride: string;
  projectOverride: string;
  extraClassIds: string[];
  extraPartyIds: string[];
  classNameOf: (id: string) => string | null;
  partyNameOf: (id: string) => string | null;
}

const orNull = (s: string) => (s.trim() === '' ? null : s.trim());

/**
 * The stored fields for a posted choice. The carried-through extra ids of *both* lists are
 * kept under Class and Project / customer; only "Neither" clears them (that is the one choice
 * that says the grant is not tracked by membership at all).
 */
export function trackingFieldsFromForm(f: TrackingFormInput): TrackingFields {
  const out: TrackingFields = {
    memberClassIds: [],
    memberPartyIds: [],
    qboClassName: orNull(f.classOverride),
    qboProjectName: orNull(f.projectOverride),
  };
  if (f.choice === 'class' && f.classValue !== '') {
    out.memberPartyIds = f.extraPartyIds;
    if (f.classValue.startsWith(NAME_PREFIX)) {
      out.memberClassIds = f.extraClassIds;
      out.qboClassName ??= orNull(f.classValue.slice(NAME_PREFIX.length));
    } else {
      out.memberClassIds = [f.classValue, ...f.extraClassIds.filter((x) => x !== f.classValue)];
      out.qboClassName ??= f.classNameOf(f.classValue);
    }
  } else if (f.choice === 'project' && f.projectValue !== '') {
    out.memberClassIds = f.extraClassIds;
    if (f.projectValue.startsWith(NAME_PREFIX)) {
      out.memberPartyIds = f.extraPartyIds;
      out.qboProjectName ??= orNull(f.projectValue.slice(NAME_PREFIX.length));
    } else {
      out.memberPartyIds = [f.projectValue, ...f.extraPartyIds.filter((x) => x !== f.projectValue)];
      out.qboProjectName ??= f.partyNameOf(f.projectValue);
    }
  }
  return out;
}

/** "1,204 transactions in the books carry this class." */
export function trackingCountSentence(count: number, choice: 'class' | 'project'): string {
  const n = count.toLocaleString('en-US');
  const noun = choice === 'class' ? 'this class' : 'this name';
  return count === 1
    ? `1 transaction in the books carries ${noun}.`
    : `${n} transactions in the books carry ${noun}.`;
}
