import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { renderTerminalReport } from "../../src/reporters/terminal.js";
import { renderJsonReport } from "../../src/reporters/json.js";
import { renderAgentReport } from "../../src/reporters/agent.js";
import { renderSarifReport } from "../../src/reporters/sarif.js";
import type { AuditResult } from "../../src/core/types.js";

describe("reporters and output formatters", () => {
  const sampleResult: AuditResult = {
    findings: [
      {
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
            message: "JSON.parse payload is unverified",
          },
        ],
        suggestedAction: "Validate payload with schema",
        safeAutomaticFix: false,
        repositoryAccepted: true,
      },
    ],
    summary: {
      errors: 1,
      warnings: 0,
      info: 0,
      highConfidence: 1,
      mediumConfidence: 0,
      lowConfidence: 0,
      filesAnalyzed: 10,
      projectsCount: 1,
    },
    repository: {
      typescriptVersion: "5.8.0",
      reactVersion: "19.0.0",
      packageManager: "pnpm",
      projectCount: 1,
      workspaceType: "pnpm",
    },
  };

  test("terminal report renders cleanly with no-color", () => {
    const text = renderTerminalReport(sampleResult, { color: false });
    assert.ok(text.includes("SourceVerity 1.0.0"));
    assert.ok(text.includes("TypeScript   5.8.0"));
    assert.ok(text.includes("React        19.0.0"));
    assert.ok(text.includes("Type safety       1 error"));
    assert.ok(text.includes("src/api/user.ts:41:18"));
    assert.ok(text.includes("typescript/unsafe-unvalidated-assertion"));
    assert.ok(text.includes("1 high-confidence findings"));
    assert.equal(text.includes("\u001B["), false, "Must not contain ANSI codes with color: false");
  });

  test("json report produces valid JSON matching result", () => {
    const jsonStr = renderJsonReport(sampleResult);
    const parsed = JSON.parse(jsonStr);
    assert.equal(parsed.findings.length, 1);
    assert.equal(parsed.summary.errors, 1);
  });

  test("agent report conforms strictly to Spec section 5 schema", () => {
    const agentJson = renderAgentReport(sampleResult);
    const parsed = JSON.parse(agentJson);

    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.tool.name, "sourceverity");
    assert.equal(parsed.tool.version, "1.0.0");
    assert.equal(parsed.repository.typescript, "5.8.0");
    assert.equal(parsed.repository.react, "19.0.0");
    assert.equal(parsed.summary.errors, 1);
    assert.equal(parsed.findings.length, 1);
    assert.equal(parsed.findings[0].fingerprint, "sv_8db21cc90a1b2c3d");
    assert.equal(parsed.findings[0].ruleId, "typescript/unsafe-unvalidated-assertion");
    assert.equal(parsed.findings[0].suggestedAction, "Validate payload with schema");
    assert.equal(parsed.findings[0].safeAutomaticFix, false);
  });

  test("sarif report conforms to SARIF 2.1.0 log schema", () => {
    const sarifJson = renderSarifReport(sampleResult);
    const parsed = JSON.parse(sarifJson);

    assert.equal(parsed.version, "2.1.0");
    assert.ok(Array.isArray(parsed.runs));
    assert.equal(parsed.runs[0].tool.driver.name, "sourceverity");
    assert.equal(parsed.runs[0].results.length, 1);
    assert.equal(parsed.runs[0].results[0].ruleId, "typescript/unsafe-unvalidated-assertion");
    assert.equal(parsed.runs[0].results[0].level, "error");
    assert.equal(parsed.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri, "src/api/user.ts");
    assert.equal(parsed.runs[0].results[0].locations[0].physicalLocation.region.startLine, 41);
  });

  test("reporters accurately format dynamically calibrated severities and confidence levels", () => {
    const calibratedResult: AuditResult = {
      findings: [
        {
          fingerprint: "sv_1111111111111111",
          ruleId: "async/floating-promise",
          category: "async",
          severity: "error",
          confidence: "high",
          message: "Promise is discarded and its rejection can escape unhandled.",
          file: "src/api/auth.ts",
          range: { start: { line: 10, column: 1 }, end: { line: 10, column: 20 } },
          evidence: [{ message: "The called function propagates unhandled rejections." }],
          suggestedAction: "Await, return, or attach rejection handling.",
          safeAutomaticFix: false,
        },
        {
          fingerprint: "sv_2222222222222222",
          ruleId: "async/floating-promise",
          category: "async",
          severity: "warning",
          confidence: "medium",
          message: "Promise returned by this call is not explicitly consumed.",
          file: "src/api/sync.ts",
          range: { start: { line: 20, column: 1 }, end: { line: 20, column: 20 } },
          evidence: [{ message: "The called function handles known failures internally." }],
          suggestedAction: "Use `void` to make intentional discard explicit.",
          safeAutomaticFix: false,
        },
        {
          fingerprint: "sv_3333333333333333",
          ruleId: "react/derived-state-effect",
          category: "react",
          severity: "warning",
          confidence: "high",
          message: "State setter is called unconditionally inside useEffect.",
          file: "src/components/View.tsx",
          range: { start: { line: 30, column: 1 }, end: { line: 32, column: 5 } },
          evidence: [{ message: "Synchronizing derived state in useEffect causes extra render." }],
          suggestedAction: "Compute the derived value directly during render.",
          safeAutomaticFix: false,
        },
      ],
      summary: {
        errors: 1,
        warnings: 2,
        info: 0,
        highConfidence: 2,
        mediumConfidence: 1,
        lowConfidence: 0,
        filesAnalyzed: 3,
        projectsCount: 1,
      },
      repository: {
        typescriptVersion: "5.9.3",
        packageManager: "npm",
        projectCount: 1,
      },
    };

    // 1. Terminal report
    const terminalText = renderTerminalReport(calibratedResult, { color: false });
    assert.ok(terminalText.includes("1 error"));
    assert.ok(terminalText.includes("1 warning"));
    assert.ok(terminalText.includes("warning · medium confidence"));
    assert.ok(terminalText.includes("warning · high confidence"));
    assert.ok(terminalText.includes("2 high-confidence findings"));
    assert.ok(terminalText.includes("1 advisory findings"));

    // 2. JSON report
    const json = JSON.parse(renderJsonReport(calibratedResult));
    assert.equal(json.summary.errors, 1);
    assert.equal(json.summary.warnings, 2);
    assert.equal(json.summary.highConfidence, 2);
    assert.equal(json.summary.mediumConfidence, 1);
    assert.equal(json.findings[0].severity, "error");
    assert.equal(json.findings[0].confidence, "high");
    assert.equal(json.findings[1].severity, "warning");
    assert.equal(json.findings[1].confidence, "medium");
    assert.equal(json.findings[2].severity, "warning");
    assert.equal(json.findings[2].confidence, "high");

    // 3. Agent report
    const agent = JSON.parse(renderAgentReport(calibratedResult));
    assert.equal(agent.summary.errors, 1);
    assert.equal(agent.summary.warnings, 2);
    assert.equal(agent.findings[0].severity, "error");
    assert.equal(agent.findings[0].confidence, "high");
    assert.equal(agent.findings[1].severity, "warning");
    assert.equal(agent.findings[1].confidence, "medium");
    assert.equal(agent.findings[2].severity, "warning");
    assert.equal(agent.findings[2].confidence, "high");

    // 4. SARIF report
    const sarif = JSON.parse(renderSarifReport(calibratedResult));
    assert.equal(sarif.runs[0].results[0].level, "error");
    assert.equal(sarif.runs[0].results[1].level, "warning");
    assert.equal(sarif.runs[0].results[2].level, "warning");
  });
});
