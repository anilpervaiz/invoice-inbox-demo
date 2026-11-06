import { mkdirSync, writeFileSync } from "node:fs";
import { writeHoldoutInvoice } from "./holdout-pdf";
import { buildHoldoutSpecs } from "./holdout-specs";

async function main() {
  mkdirSync("eval/holdout/invoices", { recursive: true });
  const specs = buildHoldoutSpecs();
  console.log(`Generating ${specs.length} held-out test invoices across 5 new layouts...`);

  for (const s of specs) {
    const path = `eval/holdout/invoices/${s.id}.pdf`;
    await writeHoldoutInvoice(s, path);
    process.stdout.write(".");
  }
  console.log("\nDone generating PDFs.");

  writeFileSync("eval/holdout/truth.json", JSON.stringify(specs, null, 2));
  console.log(`Wrote eval/holdout/truth.json (${specs.length} invoices).`);
}

main().catch((err) => {
  console.error("Failed to generate held-out invoices:", err);
  process.exit(1);
});
