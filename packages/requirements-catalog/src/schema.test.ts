import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CatalogEntrySchema, NotApplicableRecord, productionEntries, SourceSchema, type CatalogEntry } from "./schema.js";

// Synthetic fixture. Not a real catalog entry.
const base = {
  id: "TEST-05-LIP-LICENSURE",
  chapter: 5,
  title: "Synthetic test entry",
  statement: "Synthetic statement for tests.",
  sources: [{ key: "CM", locator: "Chapter 5", url: "https://example.test/cm", verifiedOn: "2026-09-27", verifiedBy: "tester" }],
  appliesTo: { awardTypes: ["section330", "lookalike"], staffTypes: ["LIP"] },
  severity: "critical",
  effective: { from: "2018-08-20", to: null },
  status: "verified",
};
const parse = (o: unknown) => CatalogEntrySchema.safeParse(o);

describe("verified-only filter", () => {
  it("drops draft and retired entries", () => {
    const v = CatalogEntrySchema.parse(base);
    const d = CatalogEntrySchema.parse({ ...base, id: "TEST-DRAFT", status: "draft" });
    const r = CatalogEntrySchema.parse({ ...base, id: "TEST-RET", status: "retired", effective: { from: "2018-08-20", to: "2020-01-01" } });
    expect(productionEntries([v, d, r]).map((e: CatalogEntry) => e.id)).toEqual([base.id]);
  });
  it("respects effective dates when asOf is given", () => {
    const v = CatalogEntrySchema.parse({ ...base, effective: { from: "2027-01-01", to: null } });
    expect(productionEntries([v], "2026-09-27")).toEqual([]);
    expect(productionEntries([v], "2027-01-01")).toHaveLength(1);
  });
  it("rejects verified entries whose source lacks verification", () => {
    expect(parse({ ...base, sources: [{ ...base.sources[0], verifiedOn: null }] }).success).toBe(false);
  });
});

describe("not applicable", () => {
  it("rejects N/A allowed without a reason", () => {
    expect(parse({ ...base, notApplicable: { allowed: true } }).success).toBe(false);
    expect(parse({ ...base, notApplicable: { allowed: true, reason: "   " } }).success).toBe(false);
    expect(parse({ ...base, notApplicable: { allowed: true, reason: "No MHC sub-program" } }).success).toBe(true);
  });
  it("rejects a health-center N/A record without a reason", () => {
    expect(NotApplicableRecord.safeParse({ requirementId: base.id, reason: "", decidedBy: "u1", decidedOn: "2026-09-27" }).success).toBe(false);
  });
});

describe("dates", () => {
  it.each(["2026-02-30", "2026-13-01", "26-01-01", "2026/01/01"])("rejects %s", (d) => {
    expect(parse({ ...base, effective: { from: d, to: null } }).success).toBe(false);
  });
  it("accepts leap day and rejects non-leap Feb 29", () => {
    expect(parse({ ...base, effective: { from: "2024-02-29", to: null } }).success).toBe(true);
    expect(parse({ ...base, effective: { from: "2025-02-29", to: null } }).success).toBe(false);
  });
  it("rejects to before from", () => {
    expect(parse({ ...base, effective: { from: "2020-01-02", to: "2020-01-01" } }).success).toBe(false);
  });
});

describe("source register", () => {
  it("every registered source parses and none claims verified without evidence", async () => {
    const { parse: parseYaml } = await import("yaml");
    const doc = parseYaml(readFileSync(new URL("../sources/sources.yaml", import.meta.url), "utf8"));
    for (const s of doc.sources) expect(SourceSchema.safeParse(s).success, s.key).toBe(true);
  });
});
