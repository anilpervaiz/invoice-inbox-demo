import { readFileSync, writeFileSync } from "node:fs";
import { aiConfigured, readWithAi } from "../lib/ai-reader";
import { processInvoice } from "../lib/decide";
import { RULE_CONTEXT } from "../lib/demo-data";
import { readWithText } from "../lib/text-reader";
import type { ReadResult } from "../lib/types";
import { SAMPLES } from "./invoice-specs";

// --simulate-ai copies the known answers in as the AI read, so the screens can be tested without a key.
// The page shows a warning when this is on, and `npm run check:release` refuses to pass.
const simulate = process.argv.includes("--simulate-ai");

async function main() {
  if (!simulate && !aiConfigured()) console.log("No AI key set: samples will show the plain-code read only.");
  const invoices = [];
  for (const s of SAMPLES) {
    const data = new Uint8Array(readFileSync(`public/samples/${s.id}.pdf`));
    const text = await readWithText(data.slice());
    const ai: ReadResult = simulate
      ? { reader: "ai", status: "ok", fields: s.fields }
      : await readWithAi(data.slice());
    invoices.push({ ...processInvoice(s.id, `${s.id}.pdf`, text, ai, RULE_CONTEXT), title: s.title });
    const last = invoices[invoices.length - 1];
    console.log(s.id.padEnd(14), `expected ${s.expected.route}`.padEnd(18), `got ${last.decision.route}`, ai.note ? `(${ai.note})` : "");
  }
  writeFileSync("data/samples.json", JSON.stringify({ simulated: simulate, aiRun: !simulate && aiConfigured(), invoices }, null, 2));
}
main();
