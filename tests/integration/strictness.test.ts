import { test, describe } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { discoverRepository } from "../../src/repository/detector.js";
import { loadRepositoryTypeScript } from "../../src/repository/tsLoader.js";
import { evaluateStrictnessGap, renderStrictnessReport } from "../../src/strictness/evaluator.js";

describe("typescript strictness gap analysis", () => {
  const fixturesDir = path.resolve(process.cwd(), "tests/fixtures");
  const tsInst = loadRepositoryTypeScript(process.cwd());

  test("evaluates strictness flags and potential diagnostic impact in loose project", async () => {
    assert.ok(tsInst !== null);
    const looseTsDir = path.join(fixturesDir, "loose-ts");
    const repo = await discoverRepository(looseTsDir);

    const report = evaluateStrictnessGap(repo, tsInst);

    assert.ok(report.currentFlags.length > 0);
    const strictFlag = report.currentFlags.find((f) => f.name === "strict");
    assert.ok(strictFlag);
    assert.equal(strictFlag.enabled, false);

    const strictNullFlag = report.currentFlags.find((f) => f.name === "strictNullChecks");
    assert.ok(strictNullFlag);
    assert.equal(strictNullFlag.enabled, false);
    assert.ok(strictNullFlag.potentialDiagnosticCount > 0, "Enabling strictNullChecks should surface diagnostics");

    const text = renderStrictnessReport(report, { color: false });
    assert.ok(text.includes("TypeScript strictness gap"));
    assert.ok(text.includes("Potential migration impact:"));
    assert.ok(text.includes("strictNullChecks"));
  });

  test("does not double-count existing compiler errors across strictness flags", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sv-strict-err-"));
    try {
      await fs.writeFile(path.join(tmpDir, "package.json"), JSON.stringify({ name: "strict-err-fixture" }));
      await fs.writeFile(path.join(tmpDir, "tsconfig.json"), JSON.stringify({
        compilerOptions: {
          strict: false,
          strictNullChecks: false,
          noImplicitAny: false,
          noUncheckedIndexedAccess: false,
        },
        include: ["src/**/*"],
      }));

      await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
      // File 1: Has 1 base type error (string assigned to number) + 1 strictNullChecks gap (null assignment)
      await fs.writeFile(
        path.join(tmpDir, "src", "index.ts"),
        `
        // Base type error present even under strict: false
        export const baseError: number = "not-a-number";

        // Error only under strictNullChecks
        export function testNull(x: string) {
          const y: string = null;
          return y;
        }
        `.trim()
      );

      // File 2: Clean file with noUncheckedIndexedAccess gap
      await fs.writeFile(
        path.join(tmpDir, "src", "indexAccess.ts"),
        `
        export function getFirst(items: string[]) {
          return items[0];
        }
        `.trim()
      );

      const repo = await discoverRepository(tmpDir);
      assert.ok(tsInst !== null);
      const report = evaluateStrictnessGap(repo, tsInst);

      // Flags that do NOT cause new errors on this code must report 0 potential diagnostics
      const noImplicitAnyFlag = report.currentFlags.find((f) => f.name === "noImplicitAny");
      assert.ok(noImplicitAnyFlag);
      // Before fix: reported 1 (the base error). After fix: must report 0
      assert.equal(
        noImplicitAnyFlag.potentialDiagnosticCount,
        0,
        "noImplicitAny should report 0 new diagnostics when code has no implicit any"
      );

      const strictNullChecksFlag = report.currentFlags.find((f) => f.name === "strictNullChecks");
      assert.ok(strictNullChecksFlag);
      // strictNullChecks introduces exactly 1 new diagnostic (null not assignable to string), NOT 1 + 1 base error = 2
      assert.equal(
        strictNullChecksFlag.potentialDiagnosticCount,
        1,
        "strictNullChecks should report only the newly introduced null check diagnostic"
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
