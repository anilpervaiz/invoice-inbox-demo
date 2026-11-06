import { mkdirSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { pdfToImage, writeInvoice } from "./invoice-pdf";
import { SAMPLES, testSet } from "./invoice-specs";

async function main() {
  mkdirSync("public/samples", { recursive: true });
  mkdirSync("eval/invoices", { recursive: true });
  for (const s of SAMPLES) {
    const pdf = `public/samples/${s.id}.pdf`;
    await writeInvoice(s, pdf);
    pdfToImage(pdf, `public/samples/${s.id}.png`, 1100, "png");
  }
  const tests = testSet();
  for (const t of tests) await writeInvoice(t, `eval/invoices/${t.id}.pdf`);
  writeFileSync("eval/truth.json", JSON.stringify(tests, null, 2));
  console.log(`samples: ${SAMPLES.length}, test invoices: ${tests.length}`);
}
main();
