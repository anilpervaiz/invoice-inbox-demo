import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Stage 4: Open-Source Readiness", () => {
  it("Task 1: LICENSE (MIT, 2026, Anil Pervaiz) exists and package.json has license, description, repository, and private: true", () => {
    expect(existsSync("LICENSE")).toBe(true);
    const license = readFileSync("LICENSE", "utf8");
    expect(license).toContain("MIT License");
    expect(license).toContain("Copyright (c) 2026 Anil Pervaiz");

    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.private).toBe(true);
    expect(pkg.license).toBe("MIT");
    expect(typeof pkg.description).toBe("string");
    expect(pkg.description.length).toBeGreaterThan(20);
    expect(pkg.repository?.url).toContain("invoice-inbox-demo");
  });

  it("Task 2: README.md follows the 8-part BUILD_RULES standard and states companies/TRNs/IBANs are made up", () => {
    const readme = readFileSync("README.md", "utf8");
    expect(readme).toContain("![Invoice Inbox");
    expect(readme).toContain("## How it decides");
    expect(readme).toContain("## Measured results");
    expect(readme).toContain("## Limits");
    expect(readme).toContain("## How to run it");
    expect(readme).toContain("## How to adapt it");
    expect(readme).toContain("## Licence");
    expect(readme).toMatch(/made up|fictional/i);
    expect(existsSync("docs/screenshot.png")).toBe(true);
  });

  it("Task 3 & 4: docs/how-it-decides.md, docs/adapt-it.md, docs/tech-stack-and-status.md, CONTRIBUTING.md, and SECURITY.md exist", () => {
    for (const file of [
      "docs/how-it-decides.md",
      "docs/adapt-it.md",
      "docs/tech-stack-and-status.md",
      "CONTRIBUTING.md",
      "SECURITY.md",
    ]) {
      expect(existsSync(file)).toBe(true);
      const content = readFileSync(file, "utf8");
      expect(content.length).toBeGreaterThan(300);
    }
    const howItDecides = readFileSync("docs/how-it-decides.md", "utf8");
    expect(howItDecides).toContain("flowchart TD");
  });

  it("Task 5: GitHub Actions CI workflow (.github/workflows/ci.yml) runs install, lint, types, tests, and build", () => {
    expect(existsSync(".github/workflows/ci.yml")).toBe(true);
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(ci).toContain("npm ci");
    expect(ci).toContain("npm run lint");
    expect(ci).toContain("npx tsc --noEmit");
    expect(ci).toContain("npm test");
    expect(ci).toContain("npm run build");
  });

  it("Task 6: No generated files (tsconfig.tsbuildinfo, .env.local, .next) are tracked in git", () => {
    const tracked = execSync("git ls-files", { encoding: "utf8" }).split("\n");
    expect(tracked).not.toContain("tsconfig.tsbuildinfo");
    expect(tracked).not.toContain(".env.local");
    expect(tracked.some((f) => f.startsWith(".next/"))).toBe(false);
    expect(tracked).toContain(".env.example");
  });
});
