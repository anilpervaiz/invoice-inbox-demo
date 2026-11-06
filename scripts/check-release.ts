import { readFileSync } from "node:fs";

// Run before publishing. A demo must never go out with simulated AI results or an unmeasured score.
const samples = JSON.parse(readFileSync("data/samples.json", "utf8"));
const report = JSON.parse(readFileSync("data/eval-report.json", "utf8"));
const problems = [
  samples.simulated && "Sample AI reads are simulated.",
  !samples.aiRun && "Samples were built without a real AI run.",
  !report.ai && "The accuracy test hasn't been run with AI.",
].filter(Boolean);
if (problems.length) {
  console.error(`Not ready to publish:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("Ready to publish.");
