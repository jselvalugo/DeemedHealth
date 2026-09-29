/**
 * The readiness engine (G1-8). `evaluate(input)` is a pure function: the same catalog
 * entry, tenant parameters, facts, as-of instant, and time zone always give the same
 * result. It reads no clock, no environment, and no host time zone; every date
 * computation goes through @deemed/dates in the site's zone.
 *
 * Order of evaluation (first match decides the status):
 *  1. production channel and the entry is not verified   -> not_assessed (fail closed)
 *  2. the entry is retired                                -> not_assessed
 *  3. the entry is not in effect on the as-of date        -> not_assessed
 *  4. the subject is outside the entry's appliesTo        -> not_assessed
 *  5. a person marked it N/A, and the catalog allows N/A  -> not_applicable
 *     (a mark the catalog no longer allows is kept, flagged na_superseded_needs_review,
 *     and the status is computed normally, never better than due_soon)
 *  6. the rule shape (expiration, periodic, one-time, on-change), with board-approval
 *     backing when the entry names one                    -> met | due_soon | overdue | missing
 *     (or not_assessed when a required tenant parameter is unset or out of bounds)
 */
import {
  type CalendarDate,
  type DueEvaluation,
  calendarPeriodAt,
  calendarPeriodOf,
  compareDates,
  currentLeadTier,
  evaluateDueAt,
  isInPeriod,
  nextDueFromLastVerification,
  toZonedDate,
} from '@deemed/dates';
import type { CatalogEntry } from '@deemed/requirements-catalog';
import { reason, summarize } from './messages.js';
import {
  approvalTypeMatches,
  capacitySatisfies,
  resolveInterval,
  resolveRule,
  type ResolvedRule,
} from './rule.js';
import {
  ENGINE_VERSION,
  type ApplicabilityContext,
  type Authority,
  type Citation,
  type EvaluationInput,
  type EvaluationResult,
  type ReadinessFact,
  type ReadinessStatus,
  type Reason,
} from './types.js';

export function authorityOf(entry: CatalogEntry): Authority {
  if (entry.layer === 'state_requirement' || entry.appliesTo.jurisdiction === 'florida') {
    return 'florida';
  }
  return entry.layer === 'best_practice' ? 'best_practice' : 'hrsa';
}

export function citationOf(entry: CatalogEntry, catalogVersion: string): Citation {
  return {
    requirementId: entry.id,
    title: entry.title,
    authority: authorityOf(entry),
    chapter: entry.chapter,
    entryStatus: entry.status,
    catalogVersion,
    sources: entry.sources.map((s) => ({
      key: s.key,
      locator: s.locator,
      url: s.url,
      verifiedOn: s.verifiedOn,
    })),
  };
}

/** The first `appliesTo` dimension the subject fails, or null when it applies. */
export function applicabilityMismatch(
  entry: CatalogEntry,
  ctx: ApplicabilityContext,
): string | null {
  const a = entry.appliesTo;
  const unknown = ctx.unknownDimensions ?? [];
  if (a.awardTypes && !a.awardTypes.includes(ctx.awardType)) return 'awardTypes';
  if (a.subPrograms && !a.subPrograms.some((p) => ctx.subPrograms.includes(p))) {
    return 'subPrograms';
  }
  if (
    a.siteTypes &&
    !unknown.includes('siteTypes') &&
    (ctx.siteType === null || !a.siteTypes.includes(ctx.siteType as never))
  ) {
    return 'siteTypes';
  }
  if (
    a.staffTypes &&
    !unknown.includes('staffTypes') &&
    (ctx.staffTypes === null || !a.staffTypes.some((t) => ctx.staffTypes?.includes(t)))
  ) {
    return 'staffTypes';
  }
  return null;
}

/** Stable order so the result never depends on the order facts arrive in. */
function compareFacts(a: ReadinessFact, b: ReadinessFact): number {
  return (
    compareDates(a.effectiveOn, b.effectiveOn) ||
    (a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** Facts known at the as-of instant, not retracted by then, and not dated in the future. */
function visibleFacts(input: EvaluationInput, asOfDate: CalendarDate): ReadinessFact[] {
  return input.facts
    .filter(
      (f) =>
        f.recordedAt <= input.asOf &&
        (f.retractedAt === null || f.retractedAt === undefined || f.retractedAt > input.asOf) &&
        compareDates(f.effectiveOn, asOfDate) <= 0,
    )
    .sort(compareFacts);
}

interface RuleOutcome {
  status: ReadinessStatus;
  nextDueOn: CalendarDate | null;
  due: DueEvaluation | null;
  leadTier: number | null;
  intervalMonths: number | null;
  reasons: Reason[];
}

/** Evidence that counts as "done": qualifying approvals when the entry is approval-backed. */
function completions(
  facts: readonly ReadinessFact[],
  rule: ResolvedRule,
  reasons: Reason[],
): ReadinessFact[] {
  if (!rule.approval) return facts.filter((f) => f.kind === 'document' || f.kind === 'completion');
  const backing = rule.approval;
  const all = facts.filter(
    (f): f is ReadinessFact & { approval: NonNullable<ReadinessFact['approval']> } =>
      f.kind === 'approval' && Boolean(f.approval),
  );
  // An approval with no type cannot show what it approved: it never counts (F2).
  if (all.some((f) => !f.approval.approvalTypeId)) reasons.push(reason('approval_type_missing'));
  const approvals = all.filter(
    (f) =>
      Boolean(f.approval.approvalTypeId) &&
      approvalTypeMatches(backing.approvalTypeId, f.approval.approvalTypeId as string),
  );
  const ok = approvals.filter(
    (f) =>
      f.approval.decision === 'approved' &&
      capacitySatisfies(backing.requiredCapacity, f.approval.capacity),
  );
  // Facts are sorted oldest first: report a rejection only when it is the latest decision.
  if (approvals.at(-1)?.approval.decision === 'rejected') {
    reasons.push(reason('approval_rejected'));
  }
  if (
    approvals.some(
      (f) =>
        f.approval.decision === 'approved' &&
        !capacitySatisfies(backing.requiredCapacity, f.approval.capacity),
    )
  ) {
    reasons.push(reason('approval_capacity_insufficient', { required: backing.requiredCapacity }));
  }
  return ok;
}

/** met / due_soon / overdue from a due date and the catalog's lead days. */
function dueOutcome(
  input: EvaluationInput,
  asOfDate: CalendarDate,
  dueOn: CalendarDate,
  leadDays: readonly number[],
  kind: 'expiration' | 'due',
): Omit<RuleOutcome, 'intervalMonths'> {
  const atRiskDays = leadDays.length > 0 ? Math.max(...leadDays) : 0;
  const due = evaluateDueAt(dueOn, input.asOf, input.timeZone, { atRiskDays });
  const leadTier = leadDays.length > 0 ? currentLeadTier(dueOn, leadDays, asOfDate) : null;
  const reasons: Reason[] = [];
  let status: ReadinessStatus;
  switch (due.status) {
    case 'overdue':
      status = 'overdue';
      reasons.push(reason(kind === 'expiration' ? 'expired' : 'past_due', { date: dueOn }));
      break;
    case 'due_today':
      status = 'due_soon';
      reasons.push(reason(kind === 'expiration' ? 'expires_today' : 'due_today', { date: dueOn }));
      break;
    case 'at_risk':
      status = 'due_soon';
      reasons.push(reason(kind === 'expiration' ? 'valid_through' : 'due_on', { date: dueOn }));
      break;
    default:
      status = 'met';
      reasons.push(reason(kind === 'expiration' ? 'valid_through' : 'due_on', { date: dueOn }));
  }
  if (leadTier !== null && leadTier > 0 && status === 'due_soon') {
    reasons.push(reason('lead_tier', { days: leadTier }));
  }
  return { status, nextDueOn: dueOn, due, leadTier, reasons };
}

function evaluateRule(
  input: EvaluationInput,
  rule: ResolvedRule,
  asOfDate: CalendarDate,
): RuleOutcome {
  const facts = visibleFacts(input, asOfDate);
  const reasons: Reason[] = [];
  const none = (status: ReadinessStatus = 'missing'): RuleOutcome => ({
    status,
    nextDueOn: null,
    due: null,
    leadTier: null,
    intervalMonths: null,
    reasons: [...reasons, reason('no_evidence')],
  });
  const shape = rule.shape;

  if (shape.kind === 'expiration') {
    const withExpiry = facts.filter(
      (f): f is ReadinessFact & { expiresOn: CalendarDate } =>
        f.kind === 'expiration' && f.expiresOn !== null && f.expiresOn !== undefined,
    );
    if (withExpiry.length === 0) return none();
    // The latest expiration on file wins (a renewal supersedes the old credential).
    const latest = withExpiry.reduce((best, f) =>
      compareDates(f.expiresOn, best.expiresOn) > 0 ||
      (compareDates(f.expiresOn, best.expiresOn) === 0 && compareFacts(f, best) > 0)
        ? f
        : best,
    );
    const out = dueOutcome(input, asOfDate, latest.expiresOn, shape.leadDays, 'expiration');
    return { ...out, reasons: [...reasons, ...out.reasons], intervalMonths: null };
  }

  const done = completions(facts, rule, reasons);

  if (shape.kind === 'one_time') {
    const last = done.at(-1);
    if (!last) return none();
    return {
      status: 'met',
      nextDueOn: null,
      due: null,
      leadTier: null,
      intervalMonths: null,
      reasons: [...reasons, reason('evidence_on_file', { date: last.effectiveOn })],
    };
  }

  if (shape.kind === 'on_change') {
    const last = done.at(-1);
    if (!last) return none();
    const change = facts.filter((f) => f.kind === 'change').at(-1);
    if (change && compareDates(change.effectiveOn, last.effectiveOn) > 0) {
      return {
        status: 'missing',
        nextDueOn: null,
        due: null,
        leadTier: null,
        intervalMonths: null,
        reasons: [...reasons, reason('changed_since_evidence', { date: change.effectiveOn })],
      };
    }
    return {
      status: 'met',
      nextDueOn: null,
      due: null,
      leadTier: null,
      intervalMonths: null,
      reasons: [...reasons, reason('evidence_on_file', { date: last.effectiveOn })],
    };
  }

  // periodic
  const interval = rule.interval as NonNullable<ResolvedRule['interval']>;
  const resolved = resolveInterval(interval, input.tenantParameters);
  if (!resolved.ok) {
    return {
      status: 'not_assessed',
      nextDueOn: null,
      due: null,
      leadTier: null,
      intervalMonths: null,
      reasons: [
        reason(resolved.code, {
          parameter: resolved.parameter,
          min: resolved.spec.min,
          max: resolved.spec.max,
          value: resolved.value,
        }),
      ],
    };
  }
  const months = resolved.months;
  const last = done.at(-1);
  if (!last) return { ...none(), intervalMonths: months };

  if (shape.basis === 'since_last_completion') {
    const dueOn = nextDueFromLastVerification(last.effectiveOn, months);
    const out = dueOutcome(input, asOfDate, dueOn, shape.leadDays, 'due');
    return {
      ...out,
      intervalMonths: months,
      reasons: [...reasons, reason('evidence_on_file', { date: last.effectiveOn }), ...out.reasons],
    };
  }

  // calendar_period: at least one completion in each calendar period of `months` months.
  const current = calendarPeriodOf(asOfDate, months);
  const inPeriod = (p: ReturnType<typeof calendarPeriodAt>) =>
    done.some((f) => isInPeriod(f.effectiveOn, p));
  if (inPeriod(current)) {
    const next = calendarPeriodAt(current.index + 1, months);
    return {
      status: 'met',
      nextDueOn: next.end,
      due: null,
      leadTier: null,
      intervalMonths: months,
      reasons: [
        ...reasons,
        reason('period_satisfied', { periodStart: current.start, periodEnd: current.end }),
        reason('due_on', { date: next.end }),
      ],
    };
  }
  const previous = calendarPeriodAt(current.index - 1, months);
  if (!inPeriod(previous)) {
    return {
      status: 'overdue',
      nextDueOn: current.end,
      due: evaluateDueAt(current.end, input.asOf, input.timeZone, { atRiskDays: 0 }),
      leadTier: null,
      intervalMonths: months,
      reasons: [
        ...reasons,
        reason('period_missed', { periodStart: previous.start, periodEnd: previous.end }),
        reason('period_pending', { periodEnd: current.end }),
      ],
    };
  }
  const out = dueOutcome(input, asOfDate, current.end, shape.leadDays, 'due');
  return {
    ...out,
    intervalMonths: months,
    reasons: [...reasons, reason('period_pending', { periodEnd: current.end }), ...out.reasons],
  };
}

export function evaluate(input: EvaluationInput): EvaluationResult {
  const { entry } = input;
  const asOfDate = toZonedDate(input.asOf, input.timeZone);
  const authority = authorityOf(entry);
  const citation = citationOf(entry, input.catalogVersion);
  const draftNote = entry.status === 'draft' ? [reason('draft_entry')] : [];

  const finish = (
    status: ReadinessStatus,
    reasons: Reason[],
    extra: Partial<
      Pick<
        EvaluationResult,
        | 'nextDueOn'
        | 'daysUntilDue'
        | 'leadTier'
        | 'rule'
        | 'intervalMonths'
        | 'notApplicableSuperseded'
      >
    > = {},
  ): EvaluationResult => {
    const all = [...reasons, ...draftNote];
    return {
      requirementId: entry.id,
      catalogVersion: input.catalogVersion,
      engineVersion: ENGINE_VERSION,
      status,
      asOfDate,
      nextDueOn: extra.nextDueOn ?? null,
      daysUntilDue: extra.daysUntilDue ?? null,
      leadTier: extra.leadTier ?? null,
      rule: extra.rule ?? null,
      intervalMonths: extra.intervalMonths ?? null,
      reasons: all,
      summary: summarize(status, all, authority),
      citation,
      notApplicableSuperseded: extra.notApplicableSuperseded ?? false,
      internalOnly: true,
    };
  };

  if (input.channel === 'production' && entry.status !== 'verified') {
    return finish('not_assessed', [reason('entry_not_verified')]);
  }
  if (entry.status === 'retired') {
    return finish('not_assessed', [
      reason('entry_retired', { catalogVersion: input.catalogVersion }),
    ]);
  }
  if (
    compareDates(asOfDate, entry.effective.from as CalendarDate) < 0 ||
    (entry.effective.to !== null && compareDates(asOfDate, entry.effective.to as CalendarDate) > 0)
  ) {
    return finish('not_assessed', [reason('not_effective', { asOfDate })]);
  }
  const mismatch = applicabilityMismatch(entry, input.applicability);
  if (mismatch) {
    return finish('not_assessed', [reason('outside_applicability', { dimension: mismatch })]);
  }

  const reasons: Reason[] = [];
  const na = input.notApplicable;
  let superseded = false;
  if (na && na.recordedAt <= input.asOf && na.hasReason) {
    if (entry.notApplicable.allowed) {
      return finish('not_applicable', [
        reason('marked_not_applicable', { decidedOn: na.decidedOn }),
      ]);
    }
    // The entry no longer allows N/A: keep the person's mark, flag it, evaluate normally.
    // TODO(S5): open a review task for the owner when a mark becomes superseded.
    superseded = true;
    reasons.push(reason('na_superseded_needs_review'));
  }

  const rule = resolveRule(entry);
  if (!rule) return finish('not_assessed', [...reasons, reason('rule_unresolved')]);
  const out = evaluateRule(input, rule, asOfDate);
  // A superseded mark needs a human decision: never report it as simply met.
  const status = superseded && out.status === 'met' ? 'due_soon' : out.status;
  return finish(status, [...reasons, ...out.reasons], {
    notApplicableSuperseded: superseded,
    nextDueOn: out.nextDueOn,
    daysUntilDue: out.due?.daysUntilDue ?? null,
    leadTier: out.leadTier,
    rule: rule.shape.kind,
    intervalMonths: out.intervalMonths,
  });
}
