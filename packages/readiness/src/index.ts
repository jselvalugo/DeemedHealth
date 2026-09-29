// @deemed/readiness: the deterministic readiness engine (G1-8). Pure: no I/O, no clock,
// no environment. The recompute job (packages/db readiness service) feeds it and stores
// the results.
export * from './types.js';
export { INTERNAL_LABEL, REASON_TEMPLATES, reason, render, summarize } from './messages.js';
export {
  approvalTypeMatches,
  capacitySatisfies,
  resolveInterval,
  resolveRule,
  type IntervalResolution,
  type ResolvedRule,
} from './rule.js';
export { applicabilityMismatch, authorityOf, citationOf, evaluate } from './evaluate.js';
export {
  buildSnapshot,
  formatScore,
  type ReadinessSnapshotBody,
  type ScoreLine,
  type SnapshotItem,
} from './snapshot.js';
