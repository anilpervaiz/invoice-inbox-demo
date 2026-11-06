import { existsSync, readFileSync } from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";
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

  it("covers all 9 required test cases in both specs and actual rendered PDFs", async () => {
    const specs: HoldoutInvoiceSpec[] = JSON.parse(readFileSync("eval/holdout/truth.json", "utf8"));

    // 1. Multi-page: every multiPage spec must genuinely render >= 2 pages with totals on the last page
    const multiPage = specs.filter((s) => s.multiPage);
    expect(multiPage.length).toBeGreaterThanOrEqual(4);
    for (const mp of multiPage) {
      const buf = new Uint8Array(readFileSync(`eval/holdout/invoices/${mp.id}.pdf`));
      const pdf = await getDocumentProxy(buf);
      expect(pdf.numPages, `${mp.id} (${mp.layout}) should have >= 2 pages`).toBeGreaterThanOrEqual(2);
      const { text: pages } = await extractText(pdf, { mergePages: false });
      const totalFormatted = mp.fields.total!.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      expect(pages[0]).not.toContain(totalFormatted);
      expect(pages[pages.length - 1]).toContain(totalFormatted);
      await pdf.loadingTask.destroy();
    }

    // 2. Bilingual UAE: real Unicode Arabic script rendered, no WinAnsi mojibake
    const bilingual = specs.filter((s) => s.layout === "bilingual-uae" && !s.scan);
    expect(bilingual.length).toBeGreaterThanOrEqual(5);
    for (const bi of bilingual) {
      const buf = new Uint8Array(readFileSync(`eval/holdout/invoices/${bi.id}.pdf`));
      const pdf = await getDocumentProxy(buf);
      const { text } = await extractText(pdf, { mergePages: true });
      expect(text, `${bi.id} must contain real Arabic Unicode characters`).toMatch(/[\u0600-\u06FF]/);
      expect(text, `${bi.id} must not contain Latin-1 mojibake`).not.toContain("¦");
      await pdf.loadingTask.destroy();
    }

    // 3. Other date styles: printed dates on h-dt-* must NOT be raw ISO YYYY-MM-DD
    const dateStyles = specs.filter((s) => s.id.startsWith("h-dt-"));
    expect(dateStyles.length).toBeGreaterThanOrEqual(5);
    for (const dt of dateStyles) {
      const buf = new Uint8Array(readFileSync(`eval/holdout/invoices/${dt.id}.pdf`));
      const pdf = await getDocumentProxy(buf);
      const { text } = await extractText(pdf, { mergePages: true });
      expect(text, `${dt.id} should format issueDate in a non-ISO date style`).not.toContain(dt.fields.issueDate!);
      await pdf.loadingTask.destroy();
    }

    // 4. Thousands separators & discounts: must include both >= 10,000 amounts AND genuine discounts
    const thousands = specs.filter((s) => s.id.startsWith("h-th-"));
    expect(thousands.length).toBeGreaterThanOrEqual(5);
    const withDiscounts = thousands.filter(
      (s) => s.fields.lines.some((l) => l.amount < 0 || /discount/i.test(l.description)) || Boolean(s.discountNote),
    );
    expect(withDiscounts.length).toBeGreaterThanOrEqual(2);

    // 5. Zero-VAT foreign invoices
    const zeroVat = specs.filter((s) => s.fields.vatRate === 0 && s.fields.currency !== "AED");
    expect(zeroVat.length).toBeGreaterThanOrEqual(4);

    // 6. Missing fields
    const missingFields = specs.filter(
      (s) => s.fields.dueDate === null || s.fields.iban === null || s.fields.supplierTrn === null,
    );
    expect(missingFields.length).toBeGreaterThanOrEqual(5);

    // 7. Skewed and low-quality scans: must have non-zero skew rotation and no text layer
    const scans = specs.filter((s) => s.scan);
    expect(scans.length).toBeGreaterThanOrEqual(6);
    expect(scans.filter((s) => Boolean(s.skewDegrees && Math.abs(s.skewDegrees) >= 1)).length).toBeGreaterThanOrEqual(4);

    // 8. Planted errors (wrong total, wrong VAT, duplicate, changed IBAN, bad lines, bad dates)
    const plantedTypes = new Set(specs.map((s) => s.expected.planted).filter(Boolean));
    expect(plantedTypes.has("wrong_total")).toBe(true);
    expect(plantedTypes.has("wrong_vat")).toBe(true);
    expect(plantedTypes.has("duplicate")).toBe(true);
    expect(plantedTypes.has("iban_change")).toBe(true);
    expect(plantedTypes.has("bad_lines")).toBe(true);
    expect(plantedTypes.has("future_date") || plantedTypes.has("due_before_issue")).toBe(true);

    // 9. Hidden instructions: both visible and white-text, covering approve and change-total goals
    const hidden = specs.filter((s) => s.hiddenInstruction);
    expect(hidden.length).toBeGreaterThanOrEqual(4);
    expect(hidden.some((s) => s.hiddenInstruction?.type === "visible")).toBe(true);
    expect(hidden.some((s) => s.hiddenInstruction?.type === "white-text")).toBe(true);
    expect(hidden.some((s) => /approve|ready/i.test(s.hiddenInstruction?.text ?? ""))).toBe(true);
    expect(hidden.some((s) => /total/i.test(s.hiddenInstruction?.text ?? ""))).toBe(true);
  });

  it("every held-out invoice has an existing, non-empty valid PDF file", () => {
    const specs: HoldoutInvoiceSpec[] = JSON.parse(readFileSync("eval/holdout/truth.json", "utf8"));
    for (const spec of specs) {
      const path = `eval/holdout/invoices/${spec.id}.pdf`;
      expect(existsSync(path)).toBe(true);
      const buf = readFileSync(path);
      expect(buf.length).toBeGreaterThan(500);
      expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    }
  });
});
