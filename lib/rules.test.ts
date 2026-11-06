import { describe, expect, it } from "vitest";
import { decide, mergeReads, processInvoice } from "./decide";
import { RULE_CONTEXT, SUPPLIERS } from "./demo-data";
import { runChecks } from "./rules";
import { EMPTY_FIELDS, type InvoiceFields, type ReadResult } from "./types";

const clean: InvoiceFields = {
  supplierName: "Creek Lane Office Supplies LLC",
  supplierTrn: SUPPLIERS[0].trn,
  invoiceNumber: "INV-20418",
  issueDate: "2026-10-20",
  dueDate: "2026-11-19",
  currency: "AED",
  subtotal: 1000,
  vatRate: 5,
  vatAmount: 50,
  total: 1050,
  iban: SUPPLIERS[0].iban,
  lines: [
    { description: "Paper", quantity: 10, unitPrice: 60, amount: 600 },
    { description: "Toner", quantity: 2, unitPrice: 200, amount: 400 },
  ],
};

const read = (reader: "text" | "ai", fields: InvoiceFields, status: ReadResult["status"] = "ok"): ReadResult => ({
  reader,
  status,
  fields,
});

const status = (fields: InvoiceFields, id: string) =>
  runChecks(fields, RULE_CONTEXT).find((c) => c.id === id)?.status;

describe("checks", () => {
  it("passes a clean invoice", () => {
    const failed = runChecks(clean, RULE_CONTEXT).filter((c) => c.status === "fail");
    expect(failed).toEqual([]);
  });

  it("fails when the total is wrong", () => {
    expect(status({ ...clean, total: 1500 }, "total")).toBe("fail");
  });

  it("fails when lines don't add up", () => {
    expect(status({ ...clean, subtotal: 1100, vatAmount: 55, total: 1155 }, "lines")).toBe("fail");
  });

  it("handles floating point amounts", () => {
    const f = { ...clean, subtotal: 0.3, vatAmount: 0.02, total: 0.32, lines: [] };
    expect(status(f, "total")).toBe("pass");
  });

  it("allows small VAT rounding but not a wrong amount", () => {
    expect(status({ ...clean, vatAmount: 50.02, total: 1050.02 }, "vat-math")).toBe("pass");
    expect(status({ ...clean, vatAmount: 80, total: 1080 }, "vat-math")).toBe("fail");
  });

  it("fails an unexpected VAT rate on an AED invoice", () => {
    expect(status({ ...clean, vatRate: 15, vatAmount: 150, total: 1150 }, "vat-rate")).toBe("fail");
  });

  it("skips the VAT rate check for foreign currency", () => {
    expect(status({ ...clean, currency: "USD" }, "vat-rate")).toBe("skip");
  });

  it("needs a 15 digit TRN when VAT is charged", () => {
    expect(status({ ...clean, supplierTrn: "1234" }, "trn")).toBe("fail");
    expect(status({ ...clean, supplierTrn: null }, "trn")).toBe("fail");
  });

  it("doesn't need a TRN with no VAT", () => {
    expect(status({ ...clean, supplierTrn: null, vatAmount: 0, vatRate: 0, total: 1000 }, "trn")).toBe("skip");
  });

  it("flags a TRN that differs from the supplier file", () => {
    expect(status({ ...clean, supplierTrn: "100000000000003" }, "trn")).toBe("fail");
  });

  it("flags changed bank details", () => {
    expect(status({ ...clean, iban: "AE00 9999 0000 1111 2222 333" }, "iban")).toBe("fail");
  });

  it("ignores spaces in an IBAN", () => {
    expect(status({ ...clean, iban: SUPPLIERS[0].iban.replace(/\s/g, "") }, "iban")).toBe("pass");
  });

  it("finds a duplicate even with different punctuation", () => {
    const f = { ...clean, supplierName: "Palm Row Catering", invoiceNumber: "prc 2291" };
    expect(status(f, "duplicate")).toBe("fail");
  });

  it("warns about the same amount under a new number", () => {
    const f = {
      ...clean,
      supplierName: "Palm Row Catering Services",
      invoiceNumber: "PRC-2299",
      total: 3360,
      issueDate: "2026-10-20",
    };
    const check = runChecks(f, RULE_CONTEXT).find((c) => c.id === "duplicate");
    expect(check?.status).toBe("fail");
    expect(check?.severity).toBe("review");
  });

  it("rejects future dates and a due date before the invoice date", () => {
    expect(status({ ...clean, issueDate: "2027-01-01", dueDate: null }, "dates")).toBe("fail");
    expect(status({ ...clean, dueDate: "2026-10-01" }, "dates")).toBe("fail");
  });

  it("reports missing fields", () => {
    expect(status({ ...EMPTY_FIELDS }, "required")).toBe("fail");
  });
});

describe("merging two reads", () => {
  it("marks fields that match as agreed, ignoring punctuation", () => {
    const { views } = mergeReads(read("text", clean), read("ai", { ...clean, invoiceNumber: "INV 20418" }));
    expect(views.find((v) => v.field === "invoiceNumber")?.agreement).toBe("agreed");
  });

  it("marks a difference as a conflict", () => {
    const { views } = mergeReads(read("text", clean), read("ai", { ...clean, total: 1060 }));
    expect(views.find((v) => v.field === "total")?.agreement).toBe("conflict");
  });

  it("marks a value only one reader found as single", () => {
    const { views } = mergeReads(read("text", { ...clean, iban: null }), read("ai", clean));
    expect(views.find((v) => v.field === "iban")?.agreement).toBe("single");
  });
});

describe("routing", () => {
  const route = (text: ReadResult, ai: ReadResult) =>
    processInvoice("x", "x.pdf", text, ai, RULE_CONTEXT).decision;

  it("sends a clean invoice read twice to ready", () => {
    expect(route(read("text", clean), read("ai", clean)).route).toBe("ready");
  });

  it("never clears an invoice on one read", () => {
    const decision = route(read("text", clean), read("ai", EMPTY_FIELDS, "unavailable"));
    expect(decision.route).toBe("review");
    expect(decision.headline).toContain("one read");
  });

  it("asks a person when the reads disagree on money", () => {
    const decision = route(read("text", clean), read("ai", { ...clean, total: 1060 }));
    expect(decision.route).toBe("review");
    expect(decision.options).toHaveLength(3);
  });

  it("blocks a duplicate", () => {
    const dup = { ...clean, supplierName: "Palm Row Catering Services", invoiceNumber: "PRC-2291" };
    expect(route(read("text", dup), read("ai", dup)).route).toBe("blocked");
  });

  it("blocks changed bank details before anything else", () => {
    const f = { ...clean, iban: "AE00 9999 0000 1111 2222 333", total: 1500 };
    const decision = route(read("text", f), read("ai", f));
    expect(decision.route).toBe("blocked");
    expect(decision.headline).toContain("bank details");
  });

  it("offers the calculated total when the total is wrong", () => {
    const f = { ...clean, total: 1500 };
    const decision = route(read("text", f), read("ai", f));
    expect(decision.route).toBe("review");
    expect(decision.options[0].set?.total).toBe(1050);
  });

  it("says so when neither reader could read the file", () => {
    const decision = route(read("text", EMPTY_FIELDS, "error"), read("ai", EMPTY_FIELDS, "unavailable"));
    expect(decision.route).toBe("review");
    expect(decision.headline).toContain("couldn't be read");
  });

  it("gives every review a question", () => {
    const f = { ...clean, vatAmount: 80, total: 1080 };
    const { fields, views } = mergeReads(read("text", f), read("ai", f));
    const decision = decide(fields, views, runChecks(fields, RULE_CONTEXT), true);
    expect(decision.question).toBeTruthy();
  });
});
