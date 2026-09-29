import { describe, expect, it } from "vitest";
import { checkEntryConventions, checkTenantParameterValue, TenantParameterSpec } from "./conventions.js";
import { CatalogEntrySchema } from "./schema.js";

// Synthetic fixtures. Not real catalog entries.
const base = {
  id: "TEST-05-PERIODIC",
  chapter: 5,
  title: "Synthetic",
  statement: "Synthetic statement for tests.",
  sources: [{ key: "CM", locator: "Chapter 5", url: null, verifiedOn: null, verifiedBy: null }],
  appliesTo: { awardTypes: ["section330", "lookalike"] },
  cadence: { trigger: "periodic", renewalMonths: 12, leadDays: [30, 0] },
  parameters: { cadenceBasis: "since_last_completion" },
  severity: "high",
  effective: { from: "2018-08-20", to: null },
  status: "draft",
};
const spec = {
  type: "integer",
  unit: "month",
  min: 1,
  max: 24,
  default: 24,
  drives: "cadence.renewalMonths",
  guidance: "Synthetic guidance.",
};
const check = (o: object) => checkEntryConventions(CatalogEntrySchema.parse({ ...base, ...o }));
const paths = (o: object) => check(o).map((i) => i.path);

describe("entry conventions", () => {
  it("accepts a well-formed periodic entry", () => {
    expect(check({})).toEqual([]);
  });

  it("keeps notes on the parsed entry", () => {
    expect(CatalogEntrySchema.parse({ ...base, notes: "Draft." }).notes).toBe("Draft.");
  });

  it("requires explicit awardTypes", () => {
    expect(paths({ appliesTo: {} })).toContain("appliesTo.awardTypes");
  });

  it("rejects unknown triggers", () => {
    expect(paths({ cadence: { trigger: "sometimes", renewalMonths: null, leadDays: [] } })).toEqual(["cadence.trigger"]);
  });

  it("expiration: needs lead days and no renewalMonths", () => {
    const exp = { trigger: "on_expiration", renewalMonths: null, leadDays: [90, 30] };
    expect(check({ cadence: exp, parameters: {} })).toEqual([]);
    expect(paths({ cadence: { ...exp, leadDays: [] }, parameters: {} })).toContain("cadence.leadDays");
    expect(paths({ cadence: { ...exp, renewalMonths: 12 }, parameters: {} })).toContain("cadence.renewalMonths");
    expect(paths({ cadence: { ...exp, leadDays: [30, 30] }, parameters: {} })).toContain("cadence.leadDays");
  });

  it("periodic: needs cadenceBasis and exactly one source of renewalMonths", () => {
    expect(paths({ parameters: {} })).toContain("parameters.cadenceBasis");
    expect(paths({ cadence: { ...base.cadence, renewalMonths: null } })).toContain("cadence.renewalMonths");
    const driven = { cadenceBasis: "since_last_completion", tenantParameters: { intervalMonths: spec } };
    expect(check({ cadence: { ...base.cadence, renewalMonths: null }, parameters: driven })).toEqual([]);
    expect(paths({ parameters: driven })).toContain("cadence.renewalMonths");
  });

  it("one-time: cadence null or on_change, no cadence parameters", () => {
    expect(check({ cadence: null, parameters: {} })).toEqual([]);
    expect(check({ cadence: { trigger: "on_change", renewalMonths: null, leadDays: [] }, parameters: {} })).toEqual([]);
    expect(paths({ cadence: null })).toContain("parameters.cadenceBasis");
  });

  it("approval: validates the approval type and capacity", () => {
    const ok = { ...base.parameters, approval: { approvalTypeId: "budget.annual", requiredCapacity: "board" } };
    expect(check({ parameters: ok })).toEqual([]);
    const staff = { ...ok, approval: { approvalTypeId: "budget.annual", requiredCapacity: "staff" } };
    expect(paths({ parameters: staff })).toContain("parameters.approval.requiredCapacity");
  });

  it("labels: FL- is a state requirement on FL sources only; BP- is best practice", () => {
    const fl = {
      id: "FL-TEST-RULE",
      chapter: null,
      layer: "state_requirement",
      appliesTo: { awardTypes: ["section330"], jurisdiction: "florida" },
      sources: [{ ...base.sources[0], key: "FL-456" }],
    };
    expect(check(fl)).toEqual([]);
    expect(paths({ ...fl, sources: base.sources })).toContain("sources.0.key");
    expect(paths({ ...fl, chapter: 5 })).toContain("chapter");
    expect(paths({ id: "FL-TEST-RULE" })).toContain("layer");
    expect(paths({ sources: [{ ...base.sources[0], key: "FL-456" }] })).toContain("sources.0.key");
    expect(check({ id: "BP-TEST", layer: "best_practice" })).toEqual([]);
    expect(paths({ layer: "best_practice" })).toContain("layer");
  });

  it("labels: CMS-/MCD- is a payer rule resting on a payer source", () => {
    const payer = {
      id: "CMS-TEST-RULE",
      layer: "payer_rule",
      sources: [{ ...base.sources[0], key: "CMS-TEST" }, base.sources[0]],
    };
    expect(check(payer)).toEqual([]);
    expect(check({ ...payer, id: "MCD-TEST-RULE", sources: [{ ...base.sources[0], key: "PL-119-21" }] })).toEqual([]);
    expect(paths({ ...payer, sources: base.sources })).toContain("sources");
    expect(paths({ ...payer, layer: "requirement" })).toContain("layer");
    expect(paths({ layer: "payer_rule", sources: [{ ...base.sources[0], key: "CMS-TEST" }] })).toContain("layer");
  });
});

describe("tenant parameters", () => {
  it("bounds must be ordered and the default inside them", () => {
    expect(TenantParameterSpec.safeParse(spec).success).toBe(true);
    expect(TenantParameterSpec.safeParse({ ...spec, default: null }).success).toBe(true);
    expect(TenantParameterSpec.safeParse({ ...spec, min: 30 }).success).toBe(false);
    expect(TenantParameterSpec.safeParse({ ...spec, default: 36 }).success).toBe(false);
    expect(TenantParameterSpec.safeParse({ ...spec, guidance: " " }).success).toBe(false);
    expect(TenantParameterSpec.safeParse({ ...spec, extra: 1 }).success).toBe(false);
  });

  it("checks a health center's value against the bounds", () => {
    const s = TenantParameterSpec.parse(spec);
    expect(checkTenantParameterValue(s, 12)).toBeNull();
    expect(checkTenantParameterValue(s, 1)).toBeNull();
    expect(checkTenantParameterValue(s, 24)).toBeNull();
    expect(checkTenantParameterValue(s, 25)).toBe("Enter a value from 1 to 24.");
    expect(checkTenantParameterValue(s, 0)).toBe("Enter a value from 1 to 24.");
    expect(checkTenantParameterValue(s, 12.5)).toBe("Enter a whole number.");
    expect(checkTenantParameterValue(s, "12")).toBe("Enter a whole number.");
  });

  it("only a periodic cadence can be driven by a tenant parameter", () => {
    const cadence = { trigger: "on_expiration", renewalMonths: null, leadDays: [30] };
    const r = checkEntryConventions(
      CatalogEntrySchema.parse({ ...base, cadence, parameters: { tenantParameters: { intervalMonths: spec } } }),
    );
    expect(r.map((i) => i.path)).toContain("parameters.tenantParameters");
  });
});
