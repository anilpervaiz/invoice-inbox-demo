import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { aiConfigured, geminiModelId, readWithAi } from "../lib/ai-reader";
import { processInvoice } from "../lib/decide";
import { RULE_CONTEXT } from "../lib/demo-data";
import { readWithText } from "../lib/text-reader";
import { EMPTY_FIELDS, SCALAR_FIELDS, type InvoiceFields, type ReadResult } from "../lib/types";

const clean = (v: unknown) => (typeof v === "string" ? v.toUpperCase().replace(/[^A-Z0-9]/g, "") : v);
const matches = (a: unknown, b: unknown) =>
  typeof a === "number" && typeof b === "number" ? Math.round(a * 100) === Math.round(b * 100) : clean(a) === clean(b);

type Tally = { right: number; total: number };
const tally = (): Tally => ({ right: 0, total: 0 });
const pct = (t: Tally) => (t.total ? Math.round((t.right / t.total) * 1000) / 10 : null);

function score(truth: InvoiceFields, read: InvoiceFields, overall: Tally, fields: Record<string, Tally>) {
  for (const f of SCALAR_FIELDS) {
    if (truth[f] === null) continue;
    fields[f] ??= tally();
    overall.total++;
    fields[f].total++;
    if (matches(truth[f], read[f])) {
      overall.right++;
      fields[f].right++;
    }
  }
}

const PLANTED_CHECK: Record<string, string> = {
  wrong_total: "total",
  wrong_vat: "vat-math",
  bad_lines: "lines",
  duplicate: "duplicate",
  iban_change: "iban",
  future_date: "dates",
};

type BaseSpec = {
  id: string;
  scan: boolean;
  layout?: string;
  multiPage?: boolean;
  hiddenInstruction?: { type: string; text: string };
  fields: InvoiceFields;
  expected: { route: "ready" | "review" | "blocked"; planted: string | null };
};

export type SetEvaluationResult = {
  invoices: number;
  scans: number;
  text: { accuracy: number | null; fieldsChecked: number };
  ai: { accuracy: number | null; fieldsChecked: number } | null;
  textByField: Record<string, number | null>;
  aiByField: Record<string, number | null> | null;
  falseClears: number;
  plantedErrors: { caught: number; total: number; notRead: number };
  cleanInvoices: { cleared: number; sentToPerson: number; total: number } | null;
  hiddenInstructions?: { tested: number; manipulated: number };
  misses: string[];
};

async function evaluateSet(
  specs: BaseSpec[],
  dirPath: string,
  useAi: boolean,
): Promise<{ result: SetEvaluationResult; aiCallsCount: number }> {
  let unread = 0;
  let falseClears = 0;
  let aiCallsCount = 0;
  const textAll = tally();
  const aiAll = tally();
  const textFields: Record<string, Tally> = {};
  const aiFields: Record<string, Tally> = {};
  const planted = tally();
  const cleanInvoices = { cleared: 0, sentToPerson: 0, total: 0 };
  const hiddenInstructions = { tested: 0, manipulated: 0 };
  const misses: string[] = [];

  for (const spec of specs) {
    const filePath = `${dirPath}/${spec.id}.pdf`;
    if (!existsSync(filePath)) {
      misses.push(`${spec.id}: file not found at ${filePath}`);
      continue;
    }
    const data = new Uint8Array(readFileSync(filePath));
    const text = await readWithText(data.slice());
    let ai: ReadResult = {
      reader: "ai",
      status: "unavailable",
      note: "AI not configured",
      fields: { ...EMPTY_FIELDS },
    };

    if (useAi) {
      ai = await readWithAi(data.slice());
      aiCallsCount++;
    }

    if (text.status === "ok") {
      score(spec.fields, text.fields, textAll, textFields);
    }
    if (useAi && ai.status === "ok") {
      score(spec.fields, ai.fields, aiAll, aiFields);
    }

    const outcome = processInvoice(spec.id, spec.id, text, ai, RULE_CONTEXT);

    // CRITICAL SAFETY CHECK: False Clears
    // An invoice with an expected problem or expected route !== ready must NEVER reach "ready".
    const hasProblem = spec.expected.planted !== null || spec.expected.route !== "ready";
    if (hasProblem && outcome.decision.route === "ready") {
      falseClears++;
      misses.push(`CRITICAL FALSE CLEAR: ${spec.id} had problem (${spec.expected.planted ?? "expected " + spec.expected.route}) but reached ready!`);
    }

    if (spec.expected.planted) {
      const checkId = PLANTED_CHECK[spec.expected.planted];
      const hit = outcome.checks.some((c) => c.id === checkId && c.status === "fail");
      if (text.status === "ok" || (useAi && ai.status === "ok")) {
        planted.total++;
        if (hit) {
          planted.right++;
        } else {
          misses.push(`${spec.id}: ${spec.expected.planted} was not caught by check '${checkId}'`);
        }
      } else {
        unread++;
      }
      if (spec.expected.route === "blocked" && outcome.decision.route !== "blocked" && (text.status === "ok" || (useAi && ai.status === "ok"))) {
        misses.push(`${spec.id}: ${spec.expected.planted} went to review, not blocked`);
      }
    } else if (useAi && !spec.scan) {
      cleanInvoices.total++;
      if (outcome.decision.route === "ready") {
        cleanInvoices.cleared++;
      } else {
        cleanInvoices.sentToPerson++;
        misses.push(`${spec.id}: clean invoice stopped for review: ${outcome.decision.headline}`);
      }
    }

    if (spec.hiddenInstruction) {
      hiddenInstructions.tested++;
      // If hidden instruction invoice had a planted error, verify it didn't clear
      if (spec.expected.route !== "ready" && outcome.decision.route === "ready") {
        hiddenInstructions.manipulated++;
        misses.push(`${spec.id}: hidden instruction bypassed checks and reached ready`);
      }
    }
  }

  const result: SetEvaluationResult = {
    invoices: specs.length,
    scans: specs.filter((s) => s.scan).length,
    text: { accuracy: pct(textAll), fieldsChecked: textAll.total },
    ai: useAi ? { accuracy: pct(aiAll), fieldsChecked: aiAll.total } : null,
    textByField: Object.fromEntries(Object.entries(textFields).map(([k, v]) => [k, pct(v)])),
    aiByField: useAi ? Object.fromEntries(Object.entries(aiFields).map(([k, v]) => [k, pct(v)])) : null,
    falseClears,
    plantedErrors: { caught: planted.right, total: planted.total, notRead: unread },
    cleanInvoices: useAi ? cleanInvoices : null,
    hiddenInstructions: hiddenInstructions.tested > 0 ? hiddenInstructions : undefined,
    misses,
  };

  return { result, aiCallsCount };
}

async function main() {
  const useAi = aiConfigured();
  const knownSpecs: BaseSpec[] = JSON.parse(readFileSync("eval/truth.json", "utf8"));
  const holdoutSpecs: BaseSpec[] = existsSync("eval/holdout/truth.json")
    ? JSON.parse(readFileSync("eval/holdout/truth.json", "utf8"))
    : [];

  const known = await evaluateSet(knownSpecs, "eval/invoices", useAi);
  const heldout = await evaluateSet(holdoutSpecs, "eval/holdout/invoices", useAi);

  const totalAiCalls = known.aiCallsCount + heldout.aiCallsCount;
  // Gemini 3.8 Flash estimated cost: approx $0.0004 per invoice read
  const estimatedAiCostUsd = useAi ? Math.round(totalAiCalls * 0.0004 * 10000) / 10000 : null;

  const report = {
    runAt: new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    model: useAi ? geminiModelId() : null,
    estimatedAiCostUsd,
    totalFalseClears: known.result.falseClears + heldout.result.falseClears,
    known: known.result,
    heldout: heldout.result,
  };

  writeFileSync("data/eval-report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1]?.endsWith("eval.ts")) {
  main().catch((err) => {
    console.error("Evaluation failed:", err);
    process.exit(1);
  });
}
