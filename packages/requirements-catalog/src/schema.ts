import { z } from "zod";

/** ISO calendar date (YYYY-MM-DD) that must also be a real date (no 2026-02-30). */
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine((s) => {
    const [y = NaN, m = NaN, d = NaN] = s.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, "Not a real calendar date");

export const Status = z.enum(["draft", "verified", "retired"]);
export type Status = z.infer<typeof Status>;

export const EffectiveRange = z
  .object({ from: IsoDate, to: IsoDate.nullable() })
  .refine((r) => r.to === null || r.to >= r.from, {
    message: "effective.to must be on or after effective.from",
    path: ["to"],
  });

// ---------------------------------------------------------------------------
// Sources (the source register)
// ---------------------------------------------------------------------------

/** Keys like PHSA-330, CM, PAL-2026-01, FL-FIPA. */
export const SourceKey = z.string().regex(/^[A-Z0-9]+(-[A-Za-z0-9&]+)*$/, "Invalid source key");

export const SourceSchema = z
  .object({
    key: SourceKey,
    title: z.string().min(1),
    url: z.string().url().nullable(),
    locator: z.string().min(1).nullable(),
    version: z.string().min(1).nullable(),
    verifiedOn: IsoDate.nullable(),
    verifiedBy: z.string().min(1).nullable().optional(),
    jurisdiction: z.enum(["federal", "florida"]).default("federal"),
    status: Status,
    notes: z.string().optional(),
  })
  .superRefine((s, ctx) => {
    if (s.status === "verified") {
      for (const f of ["url", "version", "verifiedOn", "verifiedBy"] as const) {
        if (!s[f]) ctx.addIssue({ code: "custom", path: [f], message: `verified source requires ${f}` });
      }
    }
  });
export type Source = z.infer<typeof SourceSchema>;

export const SourceRegisterSchema = z
  .object({ sources: z.array(SourceSchema) })
  .superRefine((r, ctx) => {
    const seen = new Set<string>();
    r.sources.forEach((s, i) => {
      if (seen.has(s.key)) ctx.addIssue({ code: "custom", path: ["sources", i, "key"], message: `duplicate key ${s.key}` });
      seen.add(s.key);
    });
  });

// ---------------------------------------------------------------------------
// Applicability
// ---------------------------------------------------------------------------

export const AwardType = z.enum(["section330", "lookalike"]);
export const SubProgram = z.enum(["CHC", "MHC", "HCH", "PHPC"]);
/** Site types follow Form 5B site categories. */
export const SiteType = z.enum(["service_delivery", "administrative", "mobile", "intermittent", "seasonal", "other"]);
/** Staff types used by clinical staffing rules (Compliance Manual Ch. 5). */
export const StaffType = z.enum(["LIP", "OLCP", "OCS", "non_clinical", "board_member", "contractor", "volunteer"]);

/** Omitted list = applies to all values of that dimension. */
export const Applicability = z
  .object({
    awardTypes: z.array(AwardType).min(1).optional(),
    subPrograms: z.array(SubProgram).min(1).optional(),
    siteTypes: z.array(SiteType).min(1).optional(),
    staffTypes: z.array(StaffType).min(1).optional(),
    jurisdiction: z.enum(["federal", "florida"]).default("federal"),
  })
  .strict();
export type Applicability = z.infer<typeof Applicability>;

/**
 * Whether a health center may mark this requirement "Not applicable".
 * When allowed, the catalog must say on what basis (the reason), and each
 * health-center N/A record must carry its own reason (see NotApplicableRecord).
 */
export const NotApplicable = z.discriminatedUnion("allowed", [
  z.object({ allowed: z.literal(false) }),
  z.object({ allowed: z.literal(true), reason: z.string().trim().min(1, "N/A requires a reason") }),
]);

/** A health center's decision to mark a requirement N/A (tenant data, validated with this schema). */
export const NotApplicableRecord = z.object({
  requirementId: z.string().min(1),
  reason: z.string().trim().min(1, "N/A requires a reason"),
  decidedBy: z.string().min(1),
  decidedOn: IsoDate,
});

// ---------------------------------------------------------------------------
// Catalog entry
// ---------------------------------------------------------------------------

export const RequirementId = z.string().regex(/^[A-Z0-9]+(-[A-Za-z0-9&]+)+$/, "Invalid requirementId");

export const SourceRef = z.object({
  key: SourceKey,
  locator: z.string().min(1),
  url: z.string().url().nullable(),
  verifiedOn: IsoDate.nullable(),
  verifiedBy: z.string().min(1).nullable(),
});

export const Cadence = z.object({
  trigger: z.string().min(1),
  renewalMonths: z.number().int().positive().nullable(),
  leadDays: z.array(z.number().int().nonnegative()).default([]),
});

/** Layer: HRSA/statutory requirement vs. best practice vs. state (FL) requirement. Never label best practice as an HRSA requirement. */
export const Layer = z.enum(["requirement", "best_practice", "state_requirement"]);

export const CatalogEntrySchema = z
  .object({
    id: RequirementId,
    chapter: z.number().int().min(1).max(21).nullable(),
    title: z.string().min(1),
    statement: z.string().min(1).max(1200, "Paraphrase; do not paste long passages"),
    layer: Layer.default("requirement"),
    sources: z.array(SourceRef).min(1),
    appliesTo: Applicability,
    notApplicable: NotApplicable.default({ allowed: false }),
    evidence: z.array(z.string().min(1)).default([]),
    cadence: Cadence.nullable().default(null),
    parameters: z.record(z.unknown()).default({}),
    severity: z.enum(["critical", "high", "medium", "low"]),
    effective: EffectiveRange,
    supersedes: z.array(RequirementId).default([]),
    status: Status,
    /** Reviewer notes: verification state, open questions, counsel items. Never shown to customers as a source. */
    notes: z.string().min(1).optional(),
  })
  .superRefine((e, ctx) => {
    if (e.status === "verified") {
      e.sources.forEach((s, i) => {
        for (const f of ["url", "verifiedOn", "verifiedBy"] as const) {
          if (!s[f]) ctx.addIssue({ code: "custom", path: ["sources", i, f], message: `verified entry requires source ${f}` });
        }
      });
    }
    if (e.status === "retired" && e.effective.to === null) {
      ctx.addIssue({ code: "custom", path: ["effective", "to"], message: "retired entry requires effective.to" });
    }
    if (e.supersedes.includes(e.id)) {
      ctx.addIssue({ code: "custom", path: ["supersedes"], message: "entry cannot supersede itself" });
    }
    if (e.layer === "state_requirement" && e.appliesTo.jurisdiction !== "florida") {
      ctx.addIssue({ code: "custom", path: ["appliesTo", "jurisdiction"], message: "state requirement must set jurisdiction" });
    }
  });
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

/**
 * Roadmap §2 rule 6: only verified entries are released to production tenants.
 * Optionally also restricts to entries in effect on `asOf` (YYYY-MM-DD).
 */
export function productionEntries(entries: readonly CatalogEntry[], asOf?: string): CatalogEntry[] {
  return entries.filter(
    (e) =>
      e.status === "verified" &&
      (asOf === undefined || (e.effective.from <= asOf && (e.effective.to === null || asOf <= e.effective.to))),
  );
}

/**
 * What the production bundle will hold, with a message the build prints.
 * When no entry is verified the bundle is empty, and the message says so plainly.
 */
export function describeProductionBundle(
  entries: readonly CatalogEntry[],
  asOf?: string,
): { entries: CatalogEntry[]; empty: boolean; message: string } {
  const prod = productionEntries(entries, asOf);
  const count = (s: Status) => entries.filter((e) => e.status === s).length;
  const tally = `${count("draft")} draft, ${count("verified")} verified, ${count("retired")} retired`;
  const message =
    prod.length === 0
      ? `Production catalog bundle is EMPTY: 0 of ${entries.length} entries are verified (${tally}). ` +
        "Draft entries stay in the non-production bundle until hrsa-regulatory-analyst verifies their sources."
      : `Production catalog bundle holds ${prod.length} of ${entries.length} entries (${tally}).`;
  return { entries: prod, empty: prod.length === 0, message };
}
