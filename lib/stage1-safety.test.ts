import { describe, expect, it } from "vitest";
import { checkDates, runChecks } from "./rules";
import { RULE_CONTEXT, SUPPLIERS, uploadRuleContext } from "./demo-data";
import type { InvoiceFields } from "./types";

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

describe("Stage 1 - Task 1: frozen date fix", () => {
  it("keeps RULE_CONTEXT.today fixed at 2026-11-05 for stable test/sample evals", () => {
    expect(RULE_CONTEXT.today).toBe("2026-11-05");
  });

  it("fails today's invoice under fixed RULE_CONTEXT (demonstrating the bug)", () => {
    const fixedCtxCheck = checkDates({ ...clean, issueDate: "2026-11-06", dueDate: "2026-12-06" }, RULE_CONTEXT);
    expect(fixedCtxCheck.status).toBe("fail");
    expect(fixedCtxCheck.detail).toContain("future");
  });

  it("passes an invoice dated today when using uploadRuleContext", () => {
    const now = new Date("2026-11-06T12:00:00Z");
    const ctx = uploadRuleContext(now);
    expect(ctx.today).toBe("2026-11-06");

    const check = checkDates({ ...clean, issueDate: "2026-11-06", dueDate: "2026-12-06" }, ctx);
    expect(check.status).toBe("pass");
  });

  it("still rejects genuinely future-dated invoices under uploadRuleContext", () => {
    const now = new Date("2026-11-06T12:00:00Z");
    const ctx = uploadRuleContext(now);
    const check = checkDates({ ...clean, issueDate: "2026-11-07", dueDate: "2026-12-07" }, ctx);
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("future");
  });
});
