import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { checkEntryConventions } from "./conventions.js";
import { CatalogEntrySchema, describeProductionBundle, productionEntries, type CatalogEntry } from "./schema.js";

// Loads the real draft entries in ../entries (one YAML file per requirementId,
// ADR-0003 §1) the way the compiler will, and checks them.
const dir = new URL("../entries/", import.meta.url);
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".yaml"))
  .sort();
const raw = files.map((f) => ({ file: f, doc: parseYaml(readFileSync(new URL(f, dir), "utf8")) as unknown }));
const parsed = raw.map(({ file, doc }) => ({ file, result: CatalogEntrySchema.safeParse(doc) }));
const entries: CatalogEntry[] = parsed.flatMap(({ result }) => (result.success ? [result.data] : []));

const register = parseYaml(readFileSync(new URL("../sources/sources.yaml", import.meta.url), "utf8")) as {
  sources: { key: string; status: string }[];
};
const registered = new Map(register.sources.map((s) => [s.key, s.status]));

describe("draft catalog entries", () => {
  it("has a small starter set", () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
    expect(files.length).toBeLessThanOrEqual(16);
  });

  it.each(files)("%s parses against CatalogEntrySchema", (file) => {
    const r = parsed.find((p) => p.file === file)!.result;
    expect(r.success, r.success ? "" : JSON.stringify(r.error.issues, null, 2)).toBe(true);
  });

  it.each(files)("%s follows the catalog conventions", (file) => {
    const e = entries.find((x) => `${x.id}.yaml` === file);
    expect(e, `${file}: file name must be <id>.yaml`).toBeDefined();
    expect(checkEntryConventions(e!)).toEqual([]);
  });

  it("ids are unique", () => {
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
  });

  it("every source is in the register, and neither the entry nor the source is verified", () => {
    for (const e of entries) {
      expect(e.status, e.id).toBe("draft");
      for (const s of e.sources) {
        expect(registered.has(s.key), `${e.id} cites unregistered source ${s.key}`).toBe(true);
        expect(registered.get(s.key), `${s.key} is not verified yet`).toBe("draft");
        expect([s.url, s.verifiedOn, s.verifiedBy], `${e.id} ${s.key}`).toEqual([null, null, null]);
        expect(s.locator.trim().length, `${e.id} ${s.key} locator`).toBeGreaterThan(0);
      }
    }
  });

  it("every entry says in its notes that it is an unverified draft", () => {
    for (const e of entries) expect(e.notes, e.id).toMatch(/^DRAFT, not verified\./);
  });

  it("covers every rule shape the readiness engine must handle", () => {
    const has = (pred: (e: CatalogEntry) => boolean) => entries.some(pred);
    const params = (e: CatalogEntry) => e.parameters as Record<string, unknown>;
    expect(has((e) => /expiration/.test(e.cadence?.trigger ?? "") && e.cadence!.leadDays.length > 0), "expiration").toBe(true);
    expect(has((e) => e.cadence?.trigger === "periodic" && e.cadence.renewalMonths !== null), "periodic").toBe(true);
    expect(has((e) => e.cadence === null || e.cadence.trigger === "on_change"), "one-time").toBe(true);
    expect(has((e) => (params(e).approval as { requiredCapacity?: string } | undefined)?.requiredCapacity === "board"), "board").toBe(true);
    expect(has((e) => params(e).tenantParameters !== undefined), "tenant parameter").toBe(true);
    expect(has((e) => e.notApplicable.allowed), "N/A allowed").toBe(true);
  });

  it("labels Florida rules and best practice apart from HRSA requirements", () => {
    for (const e of entries.filter((x) => x.layer === "state_requirement")) {
      expect(e.id.startsWith("FL-"), e.id).toBe(true);
      expect(e.appliesTo.jurisdiction).toBe("florida");
    }
    expect(entries.some((e) => e.layer === "state_requirement")).toBe(true);
    expect(entries.some((e) => e.layer === "best_practice")).toBe(true);
    for (const e of entries.filter((x) => x.layer === "payer_rule")) expect(e.id, e.id).toMatch(/^(CMS|MCD)-/);
    expect(entries.some((e) => e.layer === "payer_rule")).toBe(true);
  });

  it("contains no SSN-shaped value", () => {
    for (const { file } of raw) {
      expect(readFileSync(new URL(file, dir), "utf8"), file).not.toMatch(/(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])/);
    }
  });
});

describe("production bundle", () => {
  it("is empty because no entry is verified, and the build message says so", () => {
    expect(entries.length).toBe(files.length);
    expect(productionEntries(entries)).toEqual([]);
    const bundle = describeProductionBundle(entries);
    expect(bundle.empty).toBe(true);
    expect(bundle.entries).toEqual([]);
    expect(bundle.message).toBe(
      `Production catalog bundle is EMPTY: 0 of ${entries.length} entries are verified ` +
        `(${entries.length} draft, 0 verified, 0 retired). ` +
        "Draft entries stay in the non-production bundle until hrsa-regulatory-analyst verifies their sources.",
    );
  });

  it("reports a non-empty bundle with its count", () => {
    const v = { ...entries[0]!, id: "TEST-VERIFIED", status: "verified" as const };
    const bundle = describeProductionBundle([...entries, v]);
    expect(bundle.empty).toBe(false);
    expect(bundle.message).toMatch(/^Production catalog bundle holds 1 of /);
  });
});
