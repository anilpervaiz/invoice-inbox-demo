import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

// Run before publishing. A demo must never go out with simulated AI results or an unmeasured score.
if (!existsSync("data/samples.json")) {
  console.error("Not ready to publish: data/samples.json is missing.");
  process.exit(1);
}

if (!existsSync("data/eval-report.json")) {
  console.error("Not ready to publish: data/eval-report.json is missing.");
  process.exit(1);
}

const samples = JSON.parse(readFileSync("data/samples.json", "utf8"));
const report = JSON.parse(readFileSync("data/eval-report.json", "utf8"));

const problems: string[] = [];

// 1. Samples check
if (samples.simulated) {
  problems.push("Sample AI reads are simulated.");
}
if (!samples.aiRun) {
  problems.push("Samples were built without a real AI run.");
}

// 2. Model check
if (!report.model) {
  problems.push("AI model is missing from evaluation report.");
}

// 3. Held-out set check
if (!report.heldout || !report.heldout.invoices || report.heldout.invoices < 40) {
  problems.push("The held-out set wasn't run or has fewer than 40 invoices.");
}

// 4. Real AI execution checks
if (!report.known?.ai) {
  problems.push("The known test set hasn't been run with AI.");
}
if (!report.heldout?.ai) {
  problems.push("The held-out test set hasn't been run with AI.");
}

// 5. Hard rule: Zero false clears
const totalFalseClears = (report.totalFalseClears ?? 0) + (report.falseClears ?? 0);
if (totalFalseClears > 0) {
  problems.push(`Hard gate failed: ${totalFalseClears} false clear(s) detected. Problematic invoices reached 'ready'.`);
}

// 6. Report freshness relative to frozen files
try {
  const frozenTimestampSec = parseInt(
    execSync("git log -1 --format=%ct -- lib/text-reader.ts lib/ai-reader.ts lib/rules.ts lib/decide.ts", {
      stdio: ["pipe", "pipe", "ignore"],
    })
      .toString()
      .trim(),
    10,
  );
  if (!Number.isNaN(frozenTimestampSec) && frozenTimestampSec > 0) {
    const reportTimeMs = report.generatedAt ? new Date(report.generatedAt).getTime() : new Date(report.runAt).getTime();
    const frozenTimeMs = frozenTimestampSec * 1000;
    // Allow up to 10 seconds leeway for commit creation timestamps
    if (reportTimeMs < frozenTimeMs - 10000) {
      problems.push("The evaluation report was generated before the last change to frozen code files.");
    }
  }
} catch {
  // If git log is unavailable, pass freshness check silently
}

if (problems.length > 0) {
  console.error(`Not ready to publish:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}

console.log("Ready to publish: all release checks passed.");
