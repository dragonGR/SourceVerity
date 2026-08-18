import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { runAudit } from "../../src/engine/runner.js";
import type { Rule } from "../../src/core/types.js";

describe("audit execution runner", () => {
  const fixturesDir = path.resolve(process.cwd(), "tests/fixtures");

  test("runs mock rule against basic-ts fixture and returns sorted findings", async () => {
    const basicTsDir = path.join(fixturesDir, "basic-ts");

    const mockRule: Rule = {
      meta: {
        id: "mock/test-rule",
        category: "typescript",
        defaultSeverity: "warning",
        defaultConfidence: "high",
        description: "Mock test rule",
        requiresTypeInformation: true,
      },
      analyze(context) {
        context.visitNodes((node) => {
          // If identifier is named 'add'
          if ("text" in node && (node as unknown as { text: string }).text === "add") {
            context.report({
              ruleId: "mock/test-rule",
              category: "typescript",
              severity: "warning",
              confidence: "high",
              message: "Found identifier add",
              file: context.sourceFile.fileName,
              range: {
                start: { line: 1, column: 17 },
                end: { line: 1, column: 20 },
              },
              evidence: [],
              safeAutomaticFix: false,
            });
          }
        });
      },
    };

    const result = await runAudit({
      targetDir: basicTsDir,
      rules: [mockRule],
      minConfidence: "high",
    });

    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0]?.ruleId, "mock/test-rule");
    assert.ok(result.findings[0]?.fingerprint.startsWith("sv_"));
    assert.equal(result.summary.warnings, 1);
    assert.equal(result.summary.filesAnalyzed, 1);
  });
});
