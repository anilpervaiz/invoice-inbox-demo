import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
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

describe("Stage 1 - Task 2: health check spending protection", () => {
  it("public health check runs plain-code reader only and does not call readWithAi even when key is configured", async () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "dummy-key-for-test";
    const aiModule = await import("./ai-reader");
    const aiSpy = vi.spyOn(aiModule, "readWithAi").mockResolvedValue({
      reader: "ai",
      status: "ok",
      fields: { ...clean },
    });

    const samplePdf = readFileSync("public/samples/clean-local.pdf");
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => Promise.resolve(new Response(samplePdf, { status: 200, headers: { "Content-Type": "application/pdf" } })) as any,
    );

    const { GET } = await import("../app/api/health/route");
    const req = new Request("http://localhost/api/health");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.text).toBe(true);
    expect(body.ai).toBeNull();
    expect(body.mode).toBe("text-only");
    expect(aiSpy).not.toHaveBeenCalled();

    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    aiSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("rejects unauthorized requests with invalid token without calling AI", async () => {
    process.env.HEALTH_TOKEN = "test-health-secret";
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "dummy-key";
    const aiModule = await import("./ai-reader");
    const aiSpy = vi.spyOn(aiModule, "readWithAi");

    const { GET } = await import("../app/api/health/route");
    const req = new Request("http://localhost/api/health", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
    expect(aiSpy).not.toHaveBeenCalled();

    aiSpy.mockRestore();
    delete process.env.HEALTH_TOKEN;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    vi.restoreAllMocks();
  });

  it("authorized health check with valid HEALTH_TOKEN runs full AI check", async () => {
    process.env.HEALTH_TOKEN = "test-health-secret";
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "dummy-key";
    const aiModule = await import("./ai-reader");
    const aiSpy = vi.spyOn(aiModule, "readWithAi").mockResolvedValue({
      reader: "ai",
      status: "ok",
      fields: { ...clean, total: 2530.5 },
    });

    const samplePdf = readFileSync("public/samples/clean-local.pdf");
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => Promise.resolve(new Response(samplePdf, { status: 200, headers: { "Content-Type": "application/pdf" } })) as any,
    );

    const { GET } = await import("../app/api/health/route");
    const req = new Request("http://localhost/api/health", {
      headers: { Authorization: "Bearer test-health-secret" },
    });
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.text).toBe(true);
    expect(body.ai).toBe(true);
    expect(body.mode).toBe("full");
    expect(aiSpy).toHaveBeenCalledTimes(1);

    delete process.env.HEALTH_TOKEN;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    aiSpy.mockRestore();
    vi.restoreAllMocks();
  });
});
