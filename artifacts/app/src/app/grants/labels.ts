export const RESTRICTION_LABEL = {
  purpose: 'Purpose-restricted',
  time: 'Time-restricted',
  both: 'Purpose + time',
  unrestricted: 'Unrestricted',
} as const;
export const GRANT_STATUS_LABEL = {
  draft: 'Draft',
  active: 'Active',
  closed: 'Closed',
  archived: 'Archived',
} as const;
export type GrantStatusKey = keyof typeof GRANT_STATUS_LABEL;
