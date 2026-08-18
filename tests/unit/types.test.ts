import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { Finding, RuleMetadata, AuditSummary } from "../../src/core/types.js";

describe("core domain models and type safety", () => {
  test("finding structure matches expected schema", () => {
    const finding: Finding = {
      fingerprint: "sv_8db21cc90a1b2c3d",
      ruleId: "typescript/unsafe-unvalidated-assertion",
      category: "typescript",
      severity: "error",
      confidence: "high",
      message: "Unvalidated runtime data is asserted to User.",
      file: "src/api/user.ts",
      range: {
        start: { line: 41, column: 18 },
        end: { line: 41, column: 25 },
      },
      evidence: [
        {
          message: "JSON.parse returns any which is unvalidated at runtime.",
          range: {
            start: { line: 41, column: 18 },
            end: { line: 41, column: 25 },
          },
        },
      ],
      suggestedAction: "Validate payload with a schema parser before asserting.",
      safeAutomaticFix: false,
      repositoryAccepted: true,
    };

    assert.equal(finding.fingerprint, "sv_8db21cc90a1b2c3d");
    assert.equal(finding.severity, "error");
    assert.equal(finding.confidence, "high");
    assert.equal(finding.safeAutomaticFix, false);
    assert.equal(finding.evidence.length, 1);
  });

  test("rule metadata structure validation", () => {
    const meta: RuleMetadata = {
      id: "async/async-foreach",
      category: "async",
      defaultSeverity: "error",
      defaultConfidence: "high",
      description: "Detects async callbacks passed to Array.prototype.forEach.",
      requiresTypeInformation: true,
    };

    assert.equal(meta.id, "async/async-foreach");
    assert.equal(meta.requiresTypeInformation, true);
    assert.equal(meta.defaultSeverity, "error");
  });

  test("audit summary calculations", () => {
    const summary: AuditSummary = {
      errors: 3,
      warnings: 5,
      info: 2,
      highConfidence: 6,
      mediumConfidence: 3,
      lowConfidence: 1,
      filesAnalyzed: 42,
      projectsCount: 1,
    };

    assert.equal(summary.errors + summary.warnings + summary.info, 10);
    assert.equal(summary.highConfidence + summary.mediumConfidence + summary.lowConfidence, 10);
  });
});
