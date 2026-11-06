import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

export type ReleaseSamples = {
  simulated?: boolean;
  aiRun?: boolean;
};

export type ReleaseReport = {
  runAt?: string;
  generatedAt?: string;
  model?: string | null;
  totalFalseClears?: number;
  falseClears?: number;
  known?: { invoices?: number; ai?: unknown; falseClears?: number };
  heldout?: { invoices?: number; ai?: unknown; falseClears?: number };
};

export function getFrozenFilesTimestampSec(): number | null {
  try {
    const raw = execSync(
      "git log -1 --format=%ct -- lib/text-reader.ts lib/ai-reader.ts lib/rules.ts lib/decide.ts",
      { stdio: ["pipe", "pipe", "ignore"] },
    )
      .toString()
      .trim();
    const parsed = parseInt(raw, 10);
    return !Number.isNaN(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function validateRelease(
  samples: ReleaseSamples,
  report: ReleaseReport,
  frozenTimestampSec: number | null = getFrozenFilesTimestampSec(),
): string[] {
  const problems: string[] = [];

  if (samples.simulated) {
    problems.push("Sample AI reads are simulated.");
  }
  if (!samples.aiRun) {
    problems.push("Samples were built without a real AI run.");
  }
  if (!report.model) {
    problems.push("AI model is missing from evaluation report.");
  }
  if (!report.heldout || !report.heldout.invoices || report.heldout.invoices < 40) {
    problems.push("The held-out set wasn't run or has fewer than 40 invoices.");
  }
  if (!report.known?.ai) {
    problems.push("The known test set hasn't been run with AI.");
  }
  if (!report.heldout?.ai) {
    problems.push("The held-out test set hasn't been run with AI.");
  }

  const totalFalseClears =
    (report.totalFalseClears ?? 0) +
    (report.falseClears ?? 0) +
    ((report.totalFalseClears === undefined ? (report.known?.falseClears ?? 0) + (report.heldout?.falseClears ?? 0) : 0));

  if (totalFalseClears > 0) {
    problems.push(`Hard gate failed: ${totalFalseClears} false clear(s) detected. Problematic invoices reached 'ready'.`);
  }

  if (frozenTimestampSec !== null) {
    const reportTimeStr = report.generatedAt ?? report.runAt;
    const reportTimeMs = reportTimeStr ? new Date(reportTimeStr).getTime() : NaN;
    const frozenTimeMs = frozenTimestampSec * 1000;
    if (Number.isNaN(reportTimeMs) || reportTimeMs < frozenTimeMs - 10_000) {
      problems.push("The evaluation report was generated before the last change to frozen code files.");
    }
  }

  return problems;
}

if (process.argv[1]?.endsWith("check-release.ts")) {
  if (!existsSync("data/samples.json")) {
    console.error("Not ready to publish: data/samples.json is missing.");
    process.exit(1);
  }
  if (!existsSync("data/eval-report.json")) {
    console.error("Not ready to publish: data/eval-report.json is missing.");
    process.exit(1);
  }
  const samples: ReleaseSamples = JSON.parse(readFileSync("data/samples.json", "utf8"));
  const report: ReleaseReport = JSON.parse(readFileSync("data/eval-report.json", "utf8"));
  const problems = validateRelease(samples, report);
  if (problems.length > 0) {
    console.error(`Not ready to publish:\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  console.log("Ready to publish: all release checks passed.");
}
