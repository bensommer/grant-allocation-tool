import type { Matchers } from '@/domain/matchers';
import { prisma } from '@/lib/db';
import { describeRule } from '@/domain/describe-rule';

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

/**
 * List-page wording of a rule's conditions ("Program is CT Culinary Training AND account is …").
 * Kept for the allocation pages; the rule list pages call describeRule directly (JPH-26 B1).
 */
export function describeMatchers(m: Matchers, labels: LabelMaps): string {
  return describeRule({ scope: 'all', matchers: m, target: null, labels }, { wording: 'list' })
    .conditionsText;
}
