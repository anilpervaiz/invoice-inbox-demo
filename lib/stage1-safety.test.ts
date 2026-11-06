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

describe("Stage 1 - Task 3: upload safety checks", () => {
  it("inspectPdfUpload refuses files without real %PDF- header even if mime type is faked", async () => {
    const { inspectPdfUpload } = await import("./upload-guard");
    const fakePdfBytes = new TextEncoder().encode("Not a real pdf content");
    const result = await inspectPdfUpload(fakePdfBytes);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Only PDF files work here");
  });

  it("inspectPdfUpload refuses password-protected PDFs with a clear message", async () => {
    const { inspectPdfUpload } = await import("./upload-guard");
    const PDFDocument = (await import("pdfkit")).default;

    const lockedBytes = await new Promise<Uint8Array>((resolve, reject) => {
      const doc = new PDFDocument({ userPassword: "pass123", ownerPassword: "owner123" });
      const chunks: Buffer[] = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
      doc.on("error", reject);
      doc.text("Confidential invoice");
      doc.end();
    });

    const result = await inspectPdfUpload(lockedBytes);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("password-protected");
  });

  it("inspectPdfUpload enforces the 5-page limit", async () => {
    const { inspectPdfUpload } = await import("./upload-guard");
    const PDFDocument = (await import("pdfkit")).default;

    const makePdf = (pages: number) =>
      new Promise<Uint8Array>((resolve, reject) => {
        const doc = new PDFDocument();
        const chunks: Buffer[] = [];
        doc.on("data", (c) => chunks.push(c));
        doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
        doc.on("error", reject);
        for (let i = 1; i <= pages; i++) {
          doc.text(`Page ${i}`);
          if (i < pages) doc.addPage();
        }
        doc.end();
      });

    const fivePageBytes = await makePdf(5);
    const fiveResult = await inspectPdfUpload(fivePageBytes, 5);
    expect(fiveResult.ok).toBe(true);

    const sixPageBytes = await makePdf(6);
    const sixResult = await inspectPdfUpload(sixPageBytes, 5);
    expect(sixResult.ok).toBe(false);
    expect(sixResult.error).toContain("5 pages or fewer");
  });

  it("POST /api/extract rejects non-PDF and password-protected files with 400", async () => {
    const { POST } = await import("../app/api/extract/route");

    // Fake PDF with application/pdf mime type
    const form1 = new FormData();
    form1.append("file", new File(["not a pdf"], "fake.pdf", { type: "application/pdf" }));
    const req1 = new Request("http://localhost/api/extract", { method: "POST", body: form1 });
    const res1 = await POST(req1);
    expect(res1.status).toBe(400);
    const body1 = await res1.json();
    expect(body1.error).toContain("Only PDF files work here");
  });
});

describe("Stage 1 - Task 4: rate limiter interface & daily total cap & UPLOADS_ENABLED", () => {
  it("rateLimiter caps requests per IP and per site with clear reasons", async () => {
    const { createMemoryRateLimiter } = await import("./rate-limit");
    const limiter = createMemoryRateLimiter({ hourlyPerIp: 2, dailyTotal: 3 });

    // IP 1: hit 1 & 2 pass
    expect((await limiter.checkAndRecord("1.1.1.1")).allowed).toBe(true);
    expect((await limiter.checkAndRecord("1.1.1.1")).allowed).toBe(true);

    // IP 1: hit 3 blocked on hourly limit
    const ipBlock = await limiter.checkAndRecord("1.1.1.1");
    expect(ipBlock.allowed).toBe(false);
    if (!ipBlock.allowed) {
      expect(ipBlock.reason).toBe("hourly_ip");
      expect(ipBlock.error).toContain("hour");
    }

    // IP 2: hit 1 passes (site total now 3)
    expect((await limiter.checkAndRecord("2.2.2.2")).allowed).toBe(true);

    // IP 3: hit 1 blocked on daily site total (site total cap reached)
    const siteBlock = await limiter.checkAndRecord("3.3.3.3");
    expect(siteBlock.allowed).toBe(false);
    if (!siteBlock.allowed) {
      expect(siteBlock.reason).toBe("daily_site");
      expect(siteBlock.error).toContain("daily");
    }
  });

  it("isUploadsEnabled defaults to off in production and respects env override", async () => {
    const { isUploadsEnabled } = await import("./upload-guard");
    expect(isUploadsEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(isUploadsEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(isUploadsEnabled({ NODE_ENV: "production", UPLOADS_ENABLED: "true" })).toBe(true);
    expect(isUploadsEnabled({ NODE_ENV: "development", UPLOADS_ENABLED: "false" })).toBe(false);
  });

  it("POST /api/extract returns 403 when uploads are disabled", async () => {
    process.env.UPLOADS_ENABLED = "false";
    const { POST } = await import("../app/api/extract/route");
    const form = new FormData();
    form.append("file", new File(["%PDF-1.4 test"], "test.pdf", { type: "application/pdf" }));
    const req = new Request("http://localhost/api/extract", { method: "POST", body: form });
    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("disabled");
    delete process.env.UPLOADS_ENABLED;
  });
});
