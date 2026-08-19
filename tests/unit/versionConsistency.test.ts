import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SOURCEVERITY_VERSION, getSourceVerityVersion } from "../../src/core/version.js";
import { SOURCEVERITY_VERSION as indexVersion, getSourceVerityVersion as indexGetVersion } from "../../src/index.js";
import { renderTerminalReport } from "../../src/reporters/terminal.js";
import { renderAgentReport } from "../../src/reporters/agent.js";
import { renderSarifReport } from "../../src/reporters/sarif.js";
import type { AuditResult } from "../../src/core/types.js";

const execFileAsync = promisify(execFile);

describe("version consistency across all public surfaces", () => {
  const pkgPath = path.resolve(process.cwd(), "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version: string };
  const expectedVersion = pkg.version;

  const sampleResult: AuditResult = {
    findings: [],
    summary: {
      errors: 0,
      warnings: 0,
      info: 0,
      highConfidence: 0,
      mediumConfidence: 0,
      lowConfidence: 0,
      filesAnalyzed: 1,
      projectsCount: 1,
    },
    repository: {
      typescriptVersion: "5.8.0",
      projectCount: 1,
      packageManager: "npm",
    },
  };

  test("package.json is authoritative and non-empty semantic version", () => {
    assert.ok(typeof expectedVersion === "string" && expectedVersion.length > 0);
    assert.match(expectedVersion, /^\d+\.\d+\.\d+/);
  });

  test("SOURCEVERITY_VERSION and getSourceVerityVersion match package.json version", () => {
    assert.equal(SOURCEVERITY_VERSION, expectedVersion);
    assert.equal(getSourceVerityVersion(), expectedVersion);
    assert.equal(indexVersion, expectedVersion);
    assert.equal(indexGetVersion(), expectedVersion);
  });

  test("terminal reporter header includes authoritative package version", () => {
    const terminalOutput = renderTerminalReport(sampleResult, { color: false });
    assert.ok(
      terminalOutput.includes(`SourceVerity ${expectedVersion}`),
      `Terminal report must contain 'SourceVerity ${expectedVersion}', got:\n${terminalOutput}`
    );
  });

  test("agent reporter output includes authoritative package version", () => {
    const agentJson = renderAgentReport(sampleResult);
    const parsed = JSON.parse(agentJson) as { tool: { name: string; version: string } };
    assert.equal(parsed.tool.name, "sourceverity");
    assert.equal(
      parsed.tool.version,
      expectedVersion,
      `Agent report tool.version must equal '${expectedVersion}', got '${parsed.tool.version}'`
    );
  });

  test("SARIF reporter tool driver includes authoritative package version", () => {
    const sarifJson = renderSarifReport(sampleResult);
    const parsed = JSON.parse(sarifJson) as {
      runs: Array<{ tool: { driver: { name: string; version: string } } }>;
    };
    assert.ok(parsed.runs.length > 0);
    assert.equal(parsed.runs[0]?.tool.driver.name, "sourceverity");
    assert.equal(
      parsed.runs[0]?.tool.driver.version,
      expectedVersion,
      `SARIF driver version must equal '${expectedVersion}', got '${parsed.runs[0]?.tool.driver.version}'`
    );
  });

  test("CLI subprocess --version outputs authoritative package version", async () => {
    const binPath = path.resolve(process.cwd(), "bin/sourceverity.js");
    const { stdout } = await execFileAsync(process.execPath, [binPath, "--version"], {
      cwd: process.cwd(),
    });
    assert.equal(stdout.trim(), expectedVersion);
  });

  test("CLI subprocess resolves version correctly when executed from an external working directory", async () => {
    const binPath = path.resolve(process.cwd(), "bin/sourceverity.js");
    const tempDir = os.tmpdir();
    const { stdout } = await execFileAsync(process.execPath, [binPath, "--version"], {
      cwd: tempDir,
    });
    assert.equal(stdout.trim(), expectedVersion);
  });
});
