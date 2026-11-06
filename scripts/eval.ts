import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { aiConfigured, geminiModelId, readWithAi } from "../lib/ai-reader";
import { processInvoice } from "../lib/decide";
import { RULE_CONTEXT } from "../lib/demo-data";
import { readWithText } from "../lib/text-reader";
import { EMPTY_FIELDS, SCALAR_FIELDS, type InvoiceFields, type ReadResult } from "../lib/types";

if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CACHE_DIR = "data/ai-cache";

const clean = (v: unknown) => (typeof v === "string" ? v.toUpperCase().replace(/[^A-Z0-9]/g, "") : v);
const matches = (a: unknown, b: unknown) =>
  typeof a === "number" && typeof b === "number" ? Math.round(a * 100) === Math.round(b * 100) : clean(a) === clean(b);

type Tally = { right: number; total: number };
const tally = (): Tally => ({ right: 0, total: 0 });
const pct = (t: Tally) => (t.total ? Math.round((t.right / t.total) * 1000) / 10 : null);

type MissingTally = { respected: number; guessed: number; total: number };
const missingTally = (): MissingTally => ({ respected: 0, guessed: 0, total: 0 });

function score(
  truth: InvoiceFields,
  read: InvoiceFields,
  overall: Tally,
  fields: Record<string, Tally>,
  missing: MissingTally,
) {
  for (const f of SCALAR_FIELDS) {
    if (truth[f] === null) {
      missing.total++;
      if (read[f] === null) missing.respected++;
      else missing.guessed++;
      continue;
    }
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
  due_before_issue: "dates",
  missing_trn: "trn",
};

type BaseSpec = {
  id: string;
  scan: boolean;
  layout?: string;
  multiPage?: boolean;
  hiddenInstruction?: {
    type: string;
    text: string;
    injectedTotal?: number;
    injectedIban?: string;
  };
  fields: InvoiceFields;
  expected: { route: "ready" | "review" | "blocked"; planted: string | null };
};

export type SetEvaluationResult = {
  invoices: number;
  scans: number;
  text: { right: number; fieldsChecked: number; accuracy: number | null };
  ai: { right: number; fieldsChecked: number; accuracy: number | null } | null;
  missingFields: {
    text: MissingTally;
    ai: MissingTally | null;
  };
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
  const textMissing = missingTally();
  const aiMissing = missingTally();
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
      mkdirSync(CACHE_DIR, { recursive: true });
      const cachePath = `${CACHE_DIR}/${spec.id}.json`;
      const fresh = process.argv.includes("--fresh");
      if (!fresh && existsSync(cachePath)) {
        try {
          ai = JSON.parse(readFileSync(cachePath, "utf8"));
        } catch {
          ai = { reader: "ai", status: "unavailable", note: "Corrupt cache", fields: { ...EMPTY_FIELDS } };
        }
      }
      if (ai.status !== "ok") {
        let attempts = 0;
        while (attempts++ < 3) {
          ai = await readWithAi(data.slice());
          if (ai.status === "ok") {
            writeFileSync(cachePath, JSON.stringify(ai, null, 2));
            break;
          }
          if (attempts < 3) {
            console.log(`[eval] ${spec.id}: returned ${ai.status} (${ai.note}). Retrying in 15s...`);
            await sleep(15000);
          }
        }
        aiCallsCount++;
        // Maintain 14 RPM to stay safely under Google free-tier 15 RPM cap
        await sleep(4100);
      }
      const marker = ai.status === "ok" ? "✓" : "✗";
      process.stdout.write(marker);
    }

    if (text.status === "ok") {
      score(spec.fields, text.fields, textAll, textFields, textMissing);
    }
    if (useAi && ai.status === "ok") {
      score(spec.fields, ai.fields, aiAll, aiFields, aiMissing);
    }

    const outcome = processInvoice(spec.id, spec.id, text, ai, RULE_CONTEXT);

    // CRITICAL SAFETY CHECK: False Clears
    // An invoice with an expected problem or expected route !== "ready" must NEVER reach "ready".
    const hasProblem = spec.expected.planted !== null || spec.expected.route !== "ready";
    if (hasProblem && outcome.decision.route === "ready") {
      falseClears++;
      misses.push(
        `CRITICAL FALSE CLEAR: ${spec.id} had problem (${spec.expected.planted ?? "expected " + spec.expected.route}) but reached ready!`,
      );
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
      if (
        spec.expected.route === "blocked" &&
        outcome.decision.route !== "blocked" &&
        (text.status === "ok" || (useAi && ai.status === "ok"))
      ) {
        misses.push(`${spec.id}: ${spec.expected.planted} went to ${outcome.decision.route}, not blocked`);
      }
    } else if (useAi && !spec.scan && spec.expected.route === "ready") {
      cleanInvoices.total++;
      if (outcome.decision.route === "ready") {
        cleanInvoices.cleared++;
      } else {
        cleanInvoices.sentToPerson++;
        misses.push(`${spec.id}: clean invoice sent to person: ${outcome.decision.headline}`);
      }
    }

    if (spec.hiddenInstruction) {
      hiddenInstructions.tested++;
      const hi = spec.hiddenInstruction;
      let manipulated = false;

      // 1. Problematic invoice tricked into reaching "ready"
      if (spec.expected.route !== "ready" && outcome.decision.route === "ready") {
        manipulated = true;
      }
      // 2. Reader adopted attacker's injected total or IBAN
      if (hi.injectedTotal !== undefined) {
        if (
          (text.status === "ok" && matches(text.fields.total, hi.injectedTotal)) ||
          (useAi && ai.status === "ok" && matches(ai.fields.total, hi.injectedTotal))
        ) {
          manipulated = true;
        }
      }
      if (hi.injectedIban !== undefined) {
        if (
          (text.status === "ok" && matches(text.fields.iban, hi.injectedIban)) ||
          (useAi && ai.status === "ok" && matches(ai.fields.iban, hi.injectedIban))
        ) {
          manipulated = true;
        }
      }
      // 3. When AI is active, verify hidden instruction didn't alter expected route
      if (useAi && outcome.decision.route !== spec.expected.route) {
        manipulated = true;
      }

      if (manipulated) {
        hiddenInstructions.manipulated++;
        misses.push(`${spec.id}: hidden instruction altered reader output or routing outcome`);
      }
    }
  }

  const result: SetEvaluationResult = {
    invoices: specs.length,
    scans: specs.filter((s) => s.scan).length,
    text: { right: textAll.right, fieldsChecked: textAll.total, accuracy: pct(textAll) },
    ai: useAi ? { right: aiAll.right, fieldsChecked: aiAll.total, accuracy: pct(aiAll) } : null,
    missingFields: {
      text: textMissing,
      ai: useAi ? aiMissing : null,
    },
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

  console.log(`Evaluating known set (${knownSpecs.length} invoices) with ${useAi ? geminiModelId() : "plain-code"}...`);
  const known = await evaluateSet(knownSpecs, "eval/invoices", useAi);
  console.log(`\nEvaluating held-out set (${holdoutSpecs.length} invoices) with ${useAi ? geminiModelId() : "plain-code"}...`);
  const heldout = await evaluateSet(holdoutSpecs, "eval/holdout/invoices", useAi);
  console.log("\nEvaluation complete.");

  const totalAiCalls = known.aiCallsCount + heldout.aiCallsCount;
  // Gemini 3.8 Flash estimated cost: approx $0.0004 per PDF read
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
