import { z } from "zod";
import type { CatalogEntry } from "./schema.js";

/**
 * Catalog conventions: typed meaning for `cadence.trigger` and for the
 * well-known keys inside `parameters`. `CatalogEntrySchema` keeps these
 * loosely typed (a string and a record) so the entry shape stays stable; this
 * module is the contract the compiler and the readiness engine share.
 *
 * Rule shapes and how an entry expresses them:
 * - expiration with lead days: `cadence.trigger` `on_expiration` or
 *   `on_hire_and_expiration`, `renewalMonths: null`, non-empty `leadDays`. The due
 *   date is the expiration date on the evidence record.
 * - periodic: `cadence.trigger` `periodic` with `renewalMonths` (or a tenant
 *   parameter that `drives` it) and non-empty `leadDays`. `parameters.cadenceBasis`
 *   says whether the period is counted from the last completion or is a
 *   calendar period (for example "at least one meeting in each calendar month").
 * - one-time document: `cadence: null` (met once current evidence exists), or
 *   `on_change` (met once, re-opened when the underlying fact changes).
 * - board-approval-backed: `parameters.approval` names the approval type and the
 *   capacity that must record it (see docs/compliance/approval-authority.md §4).
 * - tenant parameter with bounds: `parameters.tenantParameters.<name>`.
 * - "Not applicable" allowed: `notApplicable: { allowed: true, reason }` (schema).
 */

export const CadenceTrigger = z.enum(["on_expiration", "on_hire_and_expiration", "periodic", "on_change"]);
export type CadenceTrigger = z.infer<typeof CadenceTrigger>;

export const CadenceBasis = z.enum(["since_last_completion", "calendar_period"]);

/**
 * A value the health center chooses within bounds set by the catalog
 * (ADR-0003 §7). The tenant's value lives in tenant tables and is audited.
 */
export const TenantParameterSpec = z
  .object({
    type: z.literal("integer"),
    unit: z.enum(["day", "month", "count", "percent"]),
    min: z.number().int(),
    max: z.number().int(),
    /** Used until the health center sets its own value. null = must be set at onboarding. */
    default: z.number().int().nullable(),
    /** The entry field this value fills in. Only `cadence.renewalMonths` for now. */
    drives: z.literal("cadence.renewalMonths").nullable().default(null),
    guidance: z.string().trim().min(1),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.min > p.max) ctx.addIssue({ code: "custom", path: ["max"], message: "max must be >= min" });
    if (p.default !== null && (p.default < p.min || p.default > p.max)) {
      ctx.addIssue({ code: "custom", path: ["default"], message: "default must be within [min, max]" });
    }
  });
export type TenantParameterSpec = z.infer<typeof TenantParameterSpec>;

/** Who must record the approval that satisfies the entry (approval-authority.md §4.1). */
export const ApprovalBacking = z
  .object({
    approvalTypeId: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_*]+)+$/, "Invalid approvalTypeId"),
    requiredCapacity: z.enum(["board", "board_or_committee_ratified", "designated"]),
  })
  .strict();
export type ApprovalBacking = z.infer<typeof ApprovalBacking>;

/** Well-known parameter keys. Other keys (thresholds such as `minMembers`) stay free-form. */
export const KnownParameters = z
  .object({
    cadenceBasis: CadenceBasis.optional(),
    approval: ApprovalBacking.optional(),
    tenantParameters: z.record(z.string().regex(/^[a-z][A-Za-z0-9]*$/), TenantParameterSpec).optional(),
    /** calendar_period only: how far back the engine lists missed periods (months). */
    lookbackMonths: z.number().int().positive().max(120).optional(),
  })
  .passthrough();

/**
 * The parameter keys the readiness engine evaluates. An entry with any other key (a
 * threshold such as `minMembers`) is not assessed until the engine learns it: fail closed.
 */
export const ENGINE_PARAMETER_KEYS: readonly string[] = [
  "cadenceBasis",
  "approval",
  "tenantParameters",
  "lookbackMonths",
];

export interface ConventionIssue {
  path: string;
  message: string;
}

/**
 * Checks one parsed entry against the conventions above and the labeling rules
 * (ADR-0003 §5, §6, §11). Returns an empty list when the entry is well formed.
 */
export function checkEntryConventions(e: CatalogEntry): ConventionIssue[] {
  const issues: ConventionIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  const params = KnownParameters.safeParse(e.parameters);
  if (!params.success) {
    for (const i of params.error.issues) add(["parameters", ...i.path].join("."), i.message);
    return issues;
  }
  const { cadenceBasis, tenantParameters = {} } = params.data;
  const driving = Object.entries(tenantParameters).filter(([, p]) => p.drives === "cadence.renewalMonths");

  // Applicability: awardTypes is required on every entry (ADR-0003 §5, FL-D2).
  if (!e.appliesTo.awardTypes) add("appliesTo.awardTypes", "awardTypes must be listed explicitly");

  // Layer and labeling: Florida rules are never HRSA rules, best practice is never a requirement.
  const isFlId = e.id.startsWith("FL-");
  const isBpId = e.id.startsWith("BP-");
  if (isFlId !== (e.layer === "state_requirement")) add("layer", "FL- ids and state_requirement go together");
  if (isBpId !== (e.layer === "best_practice")) add("layer", "BP- ids and best_practice go together");
  if (e.layer === "state_requirement") {
    e.sources.forEach((s, i) => {
      if (!s.key.startsWith("FL-")) add(`sources.${i}.key`, "a Florida requirement cites FL-* sources only");
    });
    if (e.chapter !== null) add("chapter", "a Florida requirement has no Compliance Manual chapter");
  }
  if (e.layer === "requirement") {
    e.sources.forEach((s, i) => {
      if (s.key.startsWith("FL-")) add(`sources.${i}.key`, "an HRSA requirement cannot rest on a Florida source");
    });
  }

  // Cadence.
  const c = e.cadence;
  if (c === null) {
    if (cadenceBasis) add("parameters.cadenceBasis", "cadenceBasis needs a periodic cadence");
    if (driving.length) add("parameters.tenantParameters", "a tenant parameter cannot drive a missing cadence");
    return issues;
  }
  const trigger = CadenceTrigger.safeParse(c.trigger);
  if (!trigger.success) {
    add("cadence.trigger", `unknown trigger; use one of ${CadenceTrigger.options.join(", ")}`);
    return issues;
  }
  const hasDueDate = trigger.data !== "on_change";
  if (hasDueDate && c.leadDays.length === 0) add("cadence.leadDays", "a dated cadence needs lead days");
  if (new Set(c.leadDays).size !== c.leadDays.length) add("cadence.leadDays", "lead days must not repeat");
  if (trigger.data === "periodic") {
    if (!cadenceBasis) add("parameters.cadenceBasis", "a periodic cadence needs cadenceBasis");
    const sources = (c.renewalMonths === null ? 0 : 1) + driving.length;
    if (sources !== 1) {
      add("cadence.renewalMonths", "set renewalMonths, or let exactly one tenant parameter drive it (not both)");
    }
  } else {
    if (c.renewalMonths !== null) add("cadence.renewalMonths", `${trigger.data} takes renewalMonths: null`);
    if (cadenceBasis) add("parameters.cadenceBasis", "cadenceBasis applies to periodic cadences only");
    if (driving.length) add("parameters.tenantParameters", "only a periodic cadence can be driven by a tenant parameter");
  }
  return issues;
}

/** Validates a health center's chosen value against the catalog bounds. */
export function checkTenantParameterValue(spec: TenantParameterSpec, value: unknown): string | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return "Enter a whole number.";
  if (value < spec.min || value > spec.max) return `Enter a value from ${spec.min} to ${spec.max}.`;
  return null;
}
