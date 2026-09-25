import type { Matchers } from '@/domain/matchers';
import { prisma } from '@/lib/db';
import { formatDate } from '@/domain/format';

export interface LabelMaps {
  programs: Map<string, string>;
  accounts: Map<string, string>;
  classes: Map<string, string>;
  locations: Map<string, string>;
  parties: Map<string, string>;
}

/** Loads id → display label maps for every entity a matcher can reference. */
export async function loadLabelMaps(orgId: string): Promise<LabelMaps> {
  const [programs, accounts, classes, locations, parties] = await Promise.all([
    prisma.program.findMany({ where: { orgId }, select: { id: true, code: true, name: true } }),
    prisma.account.findMany({ where: { orgId }, select: { id: true, number: true, name: true } }),
    prisma.trackingClass.findMany({ where: { orgId }, select: { id: true, name: true } }),
    prisma.trackingLocation.findMany({ where: { orgId }, select: { id: true, name: true } }),
    prisma.party.findMany({ where: { orgId }, select: { id: true, displayName: true } }),
  ]);
  return {
    programs: new Map(programs.map((p) => [p.id, p.name])),
    accounts: new Map(accounts.map((a) => [a.id, a.name])),
    classes: new Map(classes.map((c) => [c.id, c.name])),
    locations: new Map(locations.map((l) => [l.id, l.name])),
    parties: new Map(parties.map((p) => [p.id, p.displayName])),
  };
}

const orList = (ids: string[], map: Map<string, string>) =>
  ids.map((id) => map.get(id) ?? '(deleted)').join(' or ');

/** "Program is CT Culinary Training AND account is 6010 Salaries or 6020 Payroll taxes" */
export function describeMatchers(m: Matchers, labels: LabelMaps): string {
  const parts: string[] = [];
  if (m.programIds?.length) parts.push(`program is ${orList(m.programIds, labels.programs)}`);
  if (m.accountIds?.length) parts.push(`account is ${orList(m.accountIds, labels.accounts)}`);
  if (m.accountRange)
    parts.push(`account number is between ${m.accountRange.from} and ${m.accountRange.to}`);
  if (m.classIds?.length) parts.push(`class is ${orList(m.classIds, labels.classes)}`);
  if (m.locationIds?.length) parts.push(`location is ${orList(m.locationIds, labels.locations)}`);
  if (m.partyIds?.length) parts.push(`party is ${orList(m.partyIds, labels.parties)}`);
  if (m.descriptionContains) parts.push(`description contains "${m.descriptionContains}"`);
  if (m.descriptionContainsAny?.length)
    parts.push(
      `description contains ${m.descriptionContainsAny.map((n) => `"${n}"`).join(' or ')}`,
    );
  if (m.txnTypes?.length) parts.push(`transaction type is ${m.txnTypes.join(' or ')}`);
  if (m.amountSign) parts.push(`amount is ${m.amountSign}`);
  if (m.dateFrom && m.dateTo)
    parts.push(
      `date is ${formatDate(new Date(`${m.dateFrom}T00:00:00Z`))} to ${formatDate(new Date(`${m.dateTo}T00:00:00Z`))}`,
    );
  else if (m.dateFrom)
    parts.push(`date is on or after ${formatDate(new Date(`${m.dateFrom}T00:00:00Z`))}`);
  else if (m.dateTo)
    parts.push(`date is on or before ${formatDate(new Date(`${m.dateTo}T00:00:00Z`))}`);
  if (parts.length === 0) return 'every line (no conditions)';
  const s = parts.join(' AND ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
