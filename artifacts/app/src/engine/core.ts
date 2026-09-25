/**
 * Pure, deterministic allocation core (JPH-10). No I/O. Given source lines and
 * the overlay configuration, produces AllocatedLine pieces such that for every
 * source line Σ pieces.amountCents === line.amountCents.
 *
 * Stages, per source line:
 *   1. Allocation — lowest-priority active AllocationRule whose matchers pass
 *      and whose effective window contains the line date splits the amount
 *      across its targets (fixed_pct: shareBps; ratio_of_driver: driver values
 *      for the line's month). A priority tie is a conflict: the line is flagged
 *      and falls through to the default stage.
 *   2. Default — an unsplit line goes 100% to the program whose matchClassIds
 *      contains the line's class; none → "unassigned program".
 *   3. Crosswalk (JPH-9) — each expense piece without an explicit budget line
 *      is matched against active CrosswalkRules (matchers see the allocated
 *      program) whose grant period contains the line date. Lowest priority
 *      wins; a tie is a conflict (piece excluded from grant totals). No match →
 *      unmapped (grantId null, not an error).
 *   4. Grant stage (JPH-21, ./grant-stage.ts) — runs per grant over its member
 *      lines: decisions → grant rules → activity × category cells, producing
 *      exactly one assigned / excluded / needs_review state per member line.
 *      Grant-scoped CrosswalkRules (grantId set) never take part in stage 3.
 */
import { type Matchers, lineMatches, type MatchableLine } from '@/domain/matchers';
import { splitLargestRemainder } from '@/domain/split';
import { monthKey } from '@/domain/dates';

export type AccountKind = 'expense' | 'income' | 'other';

export interface EngineLine {
  id: string;
  accountId: string;
  accountNumber: string | null;
  accountKind: AccountKind;
  classId: string | null;
  locationId: string | null;
  partyId: string | null;
  txnPartyId: string | null;
  description: string | null;
  memo: string | null;
  txnDate: Date;
  amountCents: number;
  /** Transaction type (TxnType enum name) and document number, for matchers and review. */
  txnType?: string | null;
  docNumber?: string | null;
}

export interface EngineProgram {
  id: string;
  matchClassIds: string[];
  active: boolean;
}

export interface EngineTarget {
  sortOrder: number;
  programId: string | null;
  grantBudgetLineId: string | null;
  shareBps: number;
}

export interface EngineAllocationRule {
  id: string;
  matchers: Matchers;
  method: 'fixed_pct' | 'ratio_of_driver';
  driverKey: string | null;
  priority: number;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  active: boolean;
  targets: EngineTarget[];
}

export interface EngineCrosswalkRule {
  id: string;
  matchers: Matchers;
  grantBudgetLineId: string;
  priority: number;
  active: boolean;
}

export interface EngineBudgetLine {
  id: string;
  grantId: string;
  programId: string | null;
  /** JPH-21 two-level budgets; older callers may omit these. */
  kind?: 'funder_category' | 'working_line' | 'cell';
  activityId?: string | null;
  categoryKey?: string | null;
}

export interface EngineGrant {
  id: string;
  startDate: Date;
  endDate: Date;
  status: 'draft' | 'active' | 'closed' | 'archived';
}

export interface EngineConfig {
  programs: EngineProgram[];
  allocationRules: EngineAllocationRule[];
  crosswalkRules: EngineCrosswalkRule[];
  budgetLines: EngineBudgetLine[];
  grants: EngineGrant[];
  /** key: `${driverKey}|${period}|${programId}` → value */
  driverValues: Map<string, number>;
}

export {
  assignGrantLines,
  type GrantStageConfig,
  type GrantStageRule,
  type GrantStageBudgetLine,
  type GrantStageDecision,
  type GrantLineDraft,
  type GrantLineState,
} from './grant-stage';

export type PieceStatus =
  'ok' | 'allocation_conflict' | 'crosswalk_conflict' | 'unassigned_program';

export interface Piece {
  sourceLineId: string;
  pieceIndex: number;
  allocationRuleId: string | null;
  crosswalkRuleId: string | null;
  programId: string | null;
  grantId: string | null;
  grantBudgetLineId: string | null;
  amountCents: number;
  status: PieceStatus;
  conflictRuleIds: string[];
}

export interface EngineWarning {
  code:
    | 'allocation_conflict'
    | 'crosswalk_conflict'
    | 'unassigned_program'
    | 'driver_missing'
    | 'bad_targets';
  message: string;
  sourceLineId?: string;
  ruleIds?: string[];
}

export interface EngineResult {
  pieces: Piece[];
  warnings: EngineWarning[];
  /** Counts for the run summary. */
  stats: {
    lines: number;
    pieces: number;
    allocationConflicts: number;
    crosswalkConflicts: number;
    unassigned: number;
    unmapped: number;
  };
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

function withinWindow(date: Date, from: Date | null, to: Date | null): boolean {
  const iso = isoDate(date);
  if (from && iso < isoDate(from)) return false;
  if (to && iso > isoDate(to)) return false;
  return true;
}

function toMatchable(line: EngineLine, programId: string | null): MatchableLine {
  return {
    accountId: line.accountId,
    accountNumber: line.accountNumber,
    classId: line.classId,
    locationId: line.locationId,
    partyId: line.partyId,
    txnPartyId: line.txnPartyId,
    description: line.description,
    memo: line.memo,
    txnDate: line.txnDate,
    programId,
    txnType: line.txnType ?? null,
    amountCents: line.amountCents,
  };
}

/** Lowest priority wins; returns all rules sharing the lowest priority. */
function lowestPriority<T extends { priority: number; id: string }>(rules: T[]): T[] {
  if (rules.length === 0) return [];
  const min = Math.min(...rules.map((r) => r.priority));
  return rules.filter((r) => r.priority === min).sort((a, b) => a.id.localeCompare(b.id));
}

export function defaultProgramFor(line: EngineLine, programs: EngineProgram[]): string | null {
  if (!line.classId) return null;
  const p = programs.find((p) => p.active && p.matchClassIds.includes(line.classId!));
  return p ? p.id : null;
}

export function allocate(lines: EngineLine[], config: EngineConfig): EngineResult {
  const pieces: Piece[] = [];
  const warnings: EngineWarning[] = [];
  const stats = {
    lines: 0,
    pieces: 0,
    allocationConflicts: 0,
    crosswalkConflicts: 0,
    unassigned: 0,
    unmapped: 0,
  };
  const budgetLineById = new Map(config.budgetLines.map((b) => [b.id, b]));
  const grantById = new Map(config.grants.map((g) => [g.id, g]));
  const activeAllocRules = config.allocationRules.filter((r) => r.active);
  const activeXwalkRules = config.crosswalkRules.filter((r) => r.active);

  for (const line of lines) {
    stats.lines++;
    const conflictRuleIds: string[] = [];
    let status: PieceStatus = 'ok';

    // --- 1. allocation -------------------------------------------------------
    const candidates = activeAllocRules.filter(
      (r) =>
        withinWindow(line.txnDate, r.effectiveFrom, r.effectiveTo) &&
        lineMatches(toMatchable(line, null), { ...r.matchers, programIds: undefined }),
    );
    const winners = lowestPriority(candidates);
    let split: Array<{ target: EngineTarget; amountCents: number; ruleId: string }> | null = null;
    if (winners.length > 1) {
      status = 'allocation_conflict';
      conflictRuleIds.push(...winners.map((w) => w.id));
      stats.allocationConflicts++;
      warnings.push({
        code: 'allocation_conflict',
        message: `Line ${line.id}: ${winners.length} allocation rules share priority ${winners[0]!.priority}`,
        sourceLineId: line.id,
        ruleIds: winners.map((w) => w.id),
      });
    } else if (winners.length === 1) {
      const rule = winners[0]!;
      const targets = [...rule.targets].sort((a, b) => a.sortOrder - b.sortOrder);
      let weights: number[] | null = null;
      if (rule.method === 'fixed_pct') {
        weights = targets.map((t) => t.shareBps);
        if (weights.reduce((a, b) => a + b, 0) !== 10000 || targets.length === 0) {
          weights = null;
          warnings.push({
            code: 'bad_targets',
            message: `Rule ${rule.id}: target shares do not sum to 100%`,
            ruleIds: [rule.id],
            sourceLineId: line.id,
          });
        }
      } else {
        const period = monthKey(line.txnDate);
        weights = targets.map((t) => {
          const programId =
            t.programId ??
            (t.grantBudgetLineId
              ? (budgetLineById.get(t.grantBudgetLineId)?.programId ?? null)
              : null);
          return programId
            ? (config.driverValues.get(`${rule.driverKey}|${period}|${programId}`) ?? 0)
            : 0;
        });
        if (targets.length === 0 || weights.every((w) => w === 0)) {
          weights = null;
          warnings.push({
            code: 'driver_missing',
            message: `Rule ${rule.id}: no driver values for ${rule.driverKey} in ${period}; line ${line.id} fell through to its default program`,
            ruleIds: [rule.id],
            sourceLineId: line.id,
          });
        }
      }
      if (weights) {
        const amounts = splitLargestRemainder(line.amountCents, weights);
        split = targets.map((target, i) => ({ target, amountCents: amounts[i]!, ruleId: rule.id }));
      }
    }

    // --- 2. default ----------------------------------------------------------
    const defaultProgram = defaultProgramFor(line, config.programs);
    type Draft = {
      programId: string | null;
      grantBudgetLineId: string | null;
      allocationRuleId: string | null;
      amountCents: number;
    };
    const drafts: Draft[] = split
      ? split.map((s) => ({
          allocationRuleId: s.ruleId,
          amountCents: s.amountCents,
          grantBudgetLineId: s.target.grantBudgetLineId,
          programId:
            s.target.programId ??
            (s.target.grantBudgetLineId
              ? (budgetLineById.get(s.target.grantBudgetLineId)?.programId ?? null)
              : null),
        }))
      : [
          {
            allocationRuleId: null,
            amountCents: line.amountCents,
            grantBudgetLineId: null,
            programId: defaultProgram,
          },
        ];

    // --- 3. crosswalk --------------------------------------------------------
    drafts.forEach((d, pieceIndex) => {
      let pieceStatus: PieceStatus = status;
      const pieceConflicts = [...conflictRuleIds];
      let grantId: string | null = null;
      let grantBudgetLineId: string | null = d.grantBudgetLineId;
      let crosswalkRuleId: string | null = null;
      if (grantBudgetLineId) {
        grantId = budgetLineById.get(grantBudgetLineId)?.grantId ?? null;
      } else if (line.accountKind === 'expense') {
        const matchable = toMatchable(line, d.programId);
        const xs = activeXwalkRules.filter((r) => {
          const bl = budgetLineById.get(r.grantBudgetLineId);
          const grant = bl ? grantById.get(bl.grantId) : undefined;
          if (!bl || !grant || grant.status === 'archived') return false;
          if (!withinWindow(line.txnDate, grant.startDate, grant.endDate)) return false;
          return lineMatches(matchable, r.matchers);
        });
        const xw = lowestPriority(xs);
        if (xw.length > 1) {
          if (pieceStatus === 'ok') pieceStatus = 'crosswalk_conflict';
          pieceConflicts.push(...xw.map((r) => r.id));
          stats.crosswalkConflicts++;
          warnings.push({
            code: 'crosswalk_conflict',
            message: `Line ${line.id}: ${xw.length} crosswalk rules share priority ${xw[0]!.priority}`,
            sourceLineId: line.id,
            ruleIds: xw.map((r) => r.id),
          });
        } else if (xw.length === 1) {
          crosswalkRuleId = xw[0]!.id;
          grantBudgetLineId = xw[0]!.grantBudgetLineId;
          grantId = budgetLineById.get(grantBudgetLineId)!.grantId;
        } else {
          stats.unmapped++;
        }
      }
      if (d.programId === null) {
        if (pieceStatus === 'ok') pieceStatus = 'unassigned_program';
        stats.unassigned++;
      }
      pieces.push({
        sourceLineId: line.id,
        pieceIndex,
        allocationRuleId: d.allocationRuleId,
        crosswalkRuleId,
        programId: d.programId,
        grantId,
        grantBudgetLineId,
        amountCents: d.amountCents,
        status: pieceStatus,
        conflictRuleIds: pieceConflicts,
      });
    });
    if (defaultProgram === null && !split) {
      warnings.push({
        code: 'unassigned_program',
        message: `Line ${line.id} has no class→program default`,
        sourceLineId: line.id,
      });
    }
  }
  stats.pieces = pieces.length;
  return { pieces, warnings, stats };
}

/** Σ pieces per source line must equal the source amount. Returns offending line ids. */
export function findImbalances(
  lines: EngineLine[],
  pieces: Piece[],
): Array<{ sourceLineId: string; expected: number; actual: number }> {
  const sums = new Map<string, number>();
  for (const p of pieces) sums.set(p.sourceLineId, (sums.get(p.sourceLineId) ?? 0) + p.amountCents);
  const bad: Array<{ sourceLineId: string; expected: number; actual: number }> = [];
  for (const l of lines) {
    const actual = sums.get(l.id) ?? 0;
    if (actual !== l.amountCents) bad.push({ sourceLineId: l.id, expected: l.amountCents, actual });
  }
  return bad;
}
