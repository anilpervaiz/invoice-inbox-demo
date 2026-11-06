import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { HoldoutInvoiceSpec } from "../eval/holdout/holdout-pdf";

describe("Stage 2: Held-out Test Set Integrity", () => {
  it("contains at least 40 invoices in truth.json", () => {
    expect(existsSync("eval/holdout/truth.json")).toBe(true);
    const specs: HoldoutInvoiceSpec[] = JSON.parse(readFileSync("eval/holdout/truth.json", "utf8"));
    expect(specs.length).toBeGreaterThanOrEqual(40);
  });

  it("covers all 5 new layouts, completely distinct from the original 5", () => {
    const specs: HoldoutInvoiceSpec[] = JSON.parse(readFileSync("eval/holdout/truth.json", "utf8"));
    const layouts = new Set(specs.map((s) => s.layout));
    expect(layouts).toEqual(
      new Set(["modern-grid", "bilingual-uae", "compact-slip", "corporate-split", "tabular-border"]),
    );
  });

  it("covers all 9 required test cases per BUILD_RULES and brief", () => {
    const specs: HoldoutInvoiceSpec[] = JSON.parse(readFileSync("eval/holdout/truth.json", "utf8"));

    // 1. Multi-page
    const multiPage = specs.filter((s) => s.multiPage);
    expect(multiPage.length).toBeGreaterThanOrEqual(2);

    // 2. Bilingual UAE
    const bilingual = specs.filter((s) => s.layout === "bilingual-uae");
    expect(bilingual.length).toBeGreaterThanOrEqual(5);

    // 3. Different date styles / IDs
    const dateStyles = specs.filter((s) => s.id.startsWith("h-dt-"));
    expect(dateStyles.length).toBeGreaterThanOrEqual(4);

    // 4. Thousands separators & large totals
    const thousands = specs.filter((s) => s.id.startsWith("h-th-"));
    expect(thousands.length).toBeGreaterThanOrEqual(4);

    // 5. Zero-VAT foreign invoices
    const zeroVat = specs.filter((s) => s.fields.vatRate === 0 && s.fields.currency !== "AED");
    expect(zeroVat.length).toBeGreaterThanOrEqual(3);

    // 6. Missing fields
    const missingFields = specs.filter(
      (s) => s.fields.dueDate === null || s.fields.iban === null || s.fields.supplierTrn === null,
    );
    expect(missingFields.length).toBeGreaterThanOrEqual(4);

    // 7. Scans
    const scans = specs.filter((s) => s.scan);
    expect(scans.length).toBeGreaterThanOrEqual(5);

    // 8. Planted errors
    const planted = specs.filter((s) => s.expected.planted !== null);
    expect(planted.length).toBeGreaterThanOrEqual(6);

    // 9. Hidden instructions
    const hidden = specs.filter((s) => s.hiddenInstruction);
    expect(hidden.length).toBeGreaterThanOrEqual(2);
  });

  it("every held-out invoice has an existing, non-empty valid PDF file", () => {
    const specs: HoldoutInvoiceSpec[] = JSON.parse(readFileSync("eval/holdout/truth.json", "utf8"));
    for (const spec of specs) {
      const path = `eval/holdout/invoices/${spec.id}.pdf`;
      expect(existsSync(path)).toBe(true);
      const buf = readFileSync(path);
      expect(buf.length).toBeGreaterThan(500);
      // Valid PDF magic header
      expect(buf.slice(0, 5).toString("ascii")).toBe("%PDF-");
    }
  });
});
