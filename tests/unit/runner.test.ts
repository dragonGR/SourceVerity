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
  test("deduplicates identical findings emitted across overlapping multi-project programs", async () => {
    const monorepoDir = path.join(fixturesDir, "monorepo-pnpm");

    // Rule that reports on any function declaration in shared or app code
    let runCount = 0;
    const mockRule: Rule = {
      meta: {
        id: "mock/shared-rule",
        category: "typescript",
        defaultSeverity: "warning",
        defaultConfidence: "high",
        description: "Reports function declaration",
        requiresTypeInformation: true,
      },
      analyze(context) {
        context.visitNodes((node) => {
          if ("text" in node && (node as unknown as { text: string }).text === "UI_VERSION") {
            runCount++;
            context.report({
              ruleId: "mock/shared-rule",
              category: "typescript",
              severity: "warning",
              confidence: "high",
              message: "UI_VERSION identifier found",
              file: context.sourceFile.fileName,
              range: {
                start: { line: 1, column: 14 },
                end: { line: 1, column: 24 },
              },
              evidence: [],
              safeAutomaticFix: false,
            });
          }
        });
      },
    };

    const result = await runAudit({
      targetDir: monorepoDir,
      rules: [mockRule],
      minConfidence: "high",
    });

    // Both apps/web and packages/ui exist in monorepo
    assert.ok(result.summary.projectsCount >= 2);
    assert.ok(runCount >= 2, "Rule should have visited overlapping file in multiple projects");
    assert.equal(result.findings.length, 1, "Findings should be deduplicated to exactly 1");
    assert.equal(result.findings[0]?.ruleId, "mock/shared-rule");
    assert.equal(result.summary.warnings, 1);
  });

  test("preserves distinct findings from different rules at the same source location", async () => {
    const basicTsDir = path.join(fixturesDir, "basic-ts");

    const ruleA: Rule = {
      meta: {
        id: "mock/rule-a",
        category: "typescript",
        defaultSeverity: "error",
        defaultConfidence: "high",
        description: "Rule A",
        requiresTypeInformation: true,
      },
      analyze(context) {
        context.report({
          ruleId: "mock/rule-a",
          category: "typescript",
          severity: "error",
          confidence: "high",
          message: "Finding A at line 1",
          file: context.sourceFile.fileName,
          range: { start: { line: 1, column: 1 }, end: { line: 1, column: 10 } },
          evidence: [],
          safeAutomaticFix: false,
        });
      },
    };

    const ruleB: Rule = {
      meta: {
        id: "mock/rule-b",
        category: "async",
        defaultSeverity: "warning",
        defaultConfidence: "high",
        description: "Rule B",
        requiresTypeInformation: true,
      },
      analyze(context) {
        context.report({
          ruleId: "mock/rule-b",
          category: "async",
          severity: "warning",
          confidence: "high",
          message: "Finding B at line 1",
          file: context.sourceFile.fileName,
          range: { start: { line: 1, column: 1 }, end: { line: 1, column: 10 } },
          evidence: [],
          safeAutomaticFix: false,
        });
      },
    };

    const result = await runAudit({
      targetDir: basicTsDir,
      rules: [ruleA, ruleB],
      minConfidence: "high",
    });

    assert.equal(result.findings.length, 2);
    assert.equal(result.findings[0]?.ruleId, "mock/rule-a");
    assert.equal(result.findings[1]?.ruleId, "mock/rule-b");
    assert.equal(result.summary.errors, 1);
    assert.equal(result.summary.warnings, 1);
  });

  test("preserves distinct findings from the same rule at different source locations in the same file", async () => {
    const basicTsDir = path.join(fixturesDir, "basic-ts");

    const multiLocationRule: Rule = {
      meta: {
        id: "mock/multi-location-rule",
        category: "typescript",
        defaultSeverity: "warning",
        defaultConfidence: "high",
        description: "Multi-location rule",
        requiresTypeInformation: true,
      },
      analyze(context) {
        // Emit at line 1 (export)
        context.report({
          ruleId: "mock/multi-location-rule",
          category: "typescript",
          severity: "warning",
          confidence: "high",
          message: "Location 1",
          file: context.sourceFile.fileName,
          range: { start: { line: 1, column: 1 }, end: { line: 1, column: 7 } },
          evidence: [],
          safeAutomaticFix: false,
        });
        // Emit at line 2 (return)
        context.report({
          ruleId: "mock/multi-location-rule",
          category: "typescript",
          severity: "warning",
          confidence: "high",
          message: "Location 2",
          file: context.sourceFile.fileName,
          range: { start: { line: 2, column: 3 }, end: { line: 2, column: 9 } },
          evidence: [],
          safeAutomaticFix: false,
        });
      },
    };

    const result = await runAudit({
      targetDir: basicTsDir,
      rules: [multiLocationRule],
      minConfidence: "high",
    });

    assert.equal(result.findings.length, 2);
    assert.equal(result.findings[0]?.range.start.line, 1);
    assert.equal(result.findings[1]?.range.start.line, 2);
    assert.equal(result.summary.warnings, 2);
  });
});
