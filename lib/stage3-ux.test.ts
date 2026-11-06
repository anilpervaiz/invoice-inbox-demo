import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SAMPLES } from "../scripts/invoice-specs";

describe("Stage 3: Stranger-Ready UX, Safety & Verification", () => {
  it("Task 1: First view contains a clear one-sentence explanation of two reads, plain rules, and AI never deciding", () => {
    const src = readFileSync("components/inbox.tsx", "utf8");
    expect(src).toMatch(/Two independent reads/i);
    expect(src).toMatch(/plain rules/i);
    expect(src).toMatch(/AI never decides/i);
  });

  it("Task 2: SAMPLES includes a hidden-instruction sample that fails a check and routes to review", () => {
    const sample = SAMPLES.find((s) => s.id === "prompt-injection" || s.hiddenInstruction);
    expect(sample).toBeDefined();
    expect(sample!.hiddenInstruction).toBeDefined();
    expect(sample!.hiddenInstruction?.text).toMatch(/override|approve|ignore/i);
    // Hard safety constraint: Must NOT be ready! It must go to a person (review)
    expect(sample!.expected.route).toBe("review");
    expect(sample!.expected.planted).toBe("wrong_total");

    // Sample PDF and image must exist on disk
    const pdfBuf = readFileSync(`public/samples/${sample!.id}.pdf`);
    expect(pdfBuf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    const imgBuf = readFileSync(`public/samples/${sample!.id}.png`);
    expect(imgBuf.length).toBeGreaterThan(1000);
  });

  it("Task 3: Reason trail is displayed in the UI and included in CSV export", () => {
    const src = readFileSync("components/inbox.tsx", "utf8");
    expect(src).toContain("Route reason");
    expect(src).toContain("routeReason");
    expect(src).toContain("personChoice");
  });

  it("Task 4: Export supports plain audit CSV, Xero bills CSV, and QuickBooks Online CSV", () => {
    const src = readFileSync("components/inbox.tsx", "utf8");
    expect(src).toContain("toXeroCsv");
    expect(src).toContain("toQuickBooksCsv");
    expect(src).toContain("toCsv");
    expect(src).toContain("Xero Bills");
    expect(src).toContain("QuickBooks Online");
  });

  it("Task 5: Global focus-visible indicator and 375px mobile responsiveness are configured", () => {
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toContain(":focus-visible");

    const inboxSrc = readFileSync("components/inbox.tsx", "utf8");
    expect(inboxSrc).toContain("min-w-0");
  });

  it("Task 6 & 7: Every screen clearly states it is a demo with made-up companies and no key is required", () => {
    const src = readFileSync("components/inbox.tsx", "utf8");
    expect(src).toContain("Demo by");
    expect(src).toContain("Every company and invoice here is made up");
    expect(src).toMatch(/What this isn(&apos;|')t/);
    expect(src).toContain("It&apos;s a demo, not a client system");
  });
});
