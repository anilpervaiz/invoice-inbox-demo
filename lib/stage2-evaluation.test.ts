import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateRelease, type ReleaseReport, type ReleaseSamples } from "../scripts/check-release";

describe("Stage 2: Evaluation & Release Check Gating", () => {
  it("eval-report.json separates known and held-out sets, tracks missing fields, and reports zero false clears", () => {
    const report = JSON.parse(readFileSync("data/eval-report.json", "utf8"));
    expect(report.known).toBeDefined();
    expect(report.heldout).toBeDefined();
    expect(report.known.invoices).toBe(40);
    expect(report.heldout.invoices).toBe(48);
    expect(report.totalFalseClears).toBe(0);
    expect(report.known.falseClears).toBe(0);
    expect(report.heldout.falseClears).toBe(0);

    // Must verify missing fields were not guessed
    expect(report.heldout.missingFields).toBeDefined();
    expect(report.heldout.missingFields.text.guessed).toBe(0);
    expect(report.heldout.missingFields.text.total).toBe(11);
  });

  it("eval-report tracks adversarial prompt injection without manipulation", () => {
    const report = JSON.parse(readFileSync("data/eval-report.json", "utf8"));
    expect(report.heldout.hiddenInstructions).toBeDefined();
    expect(report.heldout.hiddenInstructions.tested).toBe(4);
    expect(report.heldout.hiddenInstructions.manipulated).toBe(0);
  });

  it("scripts/build-samples.ts and scripts/eval.ts load .env.local automatically", () => {
    const samplesSrc = readFileSync("scripts/build-samples.ts", "utf8");
    const evalSrc = readFileSync("scripts/eval.ts", "utf8");
    expect(samplesSrc).toContain("loadEnvFile");
    expect(evalSrc).toContain("loadEnvFile");
  });

  it("validateRelease fails on each required release blocker and passes only when all gates are clean", () => {
    const frozenTimestampSec = Math.floor(new Date("2026-11-06T12:00:00Z").getTime() / 1000);
    const validSamples: ReleaseSamples = { simulated: false, aiRun: true };
    const validReport: ReleaseReport = {
      runAt: "2026-11-06",
      generatedAt: "2026-11-06T13:00:00.000Z",
      model: "gemini-3.8-flash",
      totalFalseClears: 0,
      known: { invoices: 40, ai: { accuracy: 98, fieldsChecked: 374 }, falseClears: 0 },
      heldout: { invoices: 48, ai: { accuracy: 92, fieldsChecked: 451 }, falseClears: 0 },
    };

    // 1. Fails when simulated: true
    expect(validateRelease({ ...validSamples, simulated: true }, validReport, frozenTimestampSec)).toContain(
      "Sample AI reads are simulated.",
    );

    // 2. Fails when aiRun is false
    expect(validateRelease({ ...validSamples, aiRun: false }, validReport, frozenTimestampSec)).toContain(
      "Samples were built without a real AI run.",
    );

    // 3. Fails when model is missing
    expect(validateRelease(validSamples, { ...validReport, model: null }, frozenTimestampSec)).toContain(
      "AI model is missing from evaluation report.",
    );

    // 4. Fails when held-out set is missing or < 40
    expect(
      validateRelease(
        validSamples,
        { ...validReport, heldout: { ...validReport.heldout, invoices: 10 } },
        frozenTimestampSec,
      ),
    ).toContain("The held-out set wasn't run or has fewer than 40 invoices.");

    // 5. Fails when any false clear exists
    expect(validateRelease(validSamples, { ...validReport, totalFalseClears: 1 }, frozenTimestampSec)).toEqual(
      expect.arrayContaining([expect.stringContaining("false clear(s) detected")]),
    );

    // 6. Fails when report was generated before frozen code files changed
    expect(
      validateRelease(
        validSamples,
        { ...validReport, generatedAt: "2026-11-06T11:00:00.000Z" },
        frozenTimestampSec,
      ),
    ).toContain("The evaluation report was generated before the last change to frozen code files.");

    // 7. Passes when all gates are genuinely satisfied
    expect(validateRelease(validSamples, validReport, frozenTimestampSec)).toEqual([]);
  });

  it("CLI check-release blocks current workspace until real AI evaluation is run", () => {
    const checkScript = resolve("scripts/check-release.ts");
    let failed = false;
    let stderr = "";
    try {
      execSync(`npx tsx "${checkScript}"`, { stdio: "pipe" });
    } catch (e: unknown) {
      failed = true;
      const err = e as { stderr?: Buffer };
      stderr = err.stderr?.toString() ?? "";
    }
    expect(failed).toBe(true);
    expect(stderr).toContain("Not ready to publish:");
  });
});
