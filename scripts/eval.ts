import { readFileSync, writeFileSync } from "node:fs";
import { aiConfigured, readWithAi } from "../lib/ai-reader";
import { processInvoice } from "../lib/decide";
import { RULE_CONTEXT } from "../lib/demo-data";
import { readWithText } from "../lib/text-reader";
import { SCALAR_FIELDS, type InvoiceFields } from "../lib/types";
import type { InvoiceSpec } from "./invoice-pdf";

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
};

async function main() {
  let unread = 0;
  const specs: InvoiceSpec[] = JSON.parse(readFileSync("eval/truth.json", "utf8"));
  const useAi = aiConfigured();
  const textAll = tally();
  const aiAll = tally();
  const textFields: Record<string, Tally> = {};
  const aiFields: Record<string, Tally> = {};
  const byLayout: Record<string, Tally> = {};
  const planted = tally();
  const cleanCleared = tally();
  const misses: string[] = [];

  for (const spec of specs) {
    const data = new Uint8Array(readFileSync(`eval/invoices/${spec.id}.pdf`));
    const text = await readWithText(data.slice());
    const ai = await readWithAi(data.slice());
    if (text.status === "ok") {
      score(spec.fields, text.fields, textAll, textFields);
      byLayout[spec.layout] ??= tally();
      score(spec.fields, text.fields, byLayout[spec.layout], {});
    }
    if (ai.status === "ok") score(spec.fields, ai.fields, aiAll, aiFields);

    const result = processInvoice(spec.id, spec.id, text, ai, RULE_CONTEXT);
    if (spec.expected.planted) {
      // Caught means the right check failed, not just that the invoice stopped for some other reason.
      const checkId = PLANTED_CHECK[spec.expected.planted];
      const hit = result.checks.some((c) => c.id === checkId && c.status === "fail");
      if (text.status === "ok" || ai.status === "ok") {
        planted.total++;
        if (hit) planted.right++;
        else misses.push(`${spec.id}: ${spec.expected.planted} was not caught`);
      } else {
        unread++;
      }
      if (spec.expected.route === "blocked" && result.decision.route !== "blocked" && (text.status === "ok" || ai.status === "ok")) {
        misses.push(`${spec.id}: ${spec.expected.planted} went to review, not blocked`);
      }
    } else if (useAi && !spec.scan) {
      cleanCleared.total++;
      if (result.decision.route === "ready") cleanCleared.right++;
      else misses.push(`${spec.id}: clean invoice stopped: ${result.decision.headline}`);
    }
  }

  const report = {
    runAt: new Date().toISOString().slice(0, 10),
    invoices: specs.length,
    scans: specs.filter((s) => s.scan).length,
    source: "Generated test invoices in 5 layouts, not real invoices",
    model: useAi ? (process.env.GEMINI_MODEL ?? "gemini-2.5-flash") : null,
    text: { accuracy: pct(textAll), fieldsChecked: textAll.total },
    ai: useAi ? { accuracy: pct(aiAll), fieldsChecked: aiAll.total } : null,
    textByLayout: Object.fromEntries(Object.entries(byLayout).map(([k, v]) => [k, pct(v)])),
    textByField: Object.fromEntries(Object.entries(textFields).map(([k, v]) => [k, pct(v)])),
    aiByField: useAi ? Object.fromEntries(Object.entries(aiFields).map(([k, v]) => [k, pct(v)])) : null,
    plantedErrors: { caught: planted.right, total: planted.total, notRead: unread },
    cleanInvoicesCleared: useAi ? { cleared: cleanCleared.right, total: cleanCleared.total } : null,
    misses,
  };
  writeFileSync("data/eval-report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main();
