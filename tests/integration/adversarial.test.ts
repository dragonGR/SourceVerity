import { test, describe } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { runAudit } from "../../src/engine/runner.js";
import { computeFingerprint } from "../../src/core/fingerprint.js";
import { normalizePath } from "../../src/core/paths.js";
import { runRuleOnCode } from "../rules/ruleTestUtils.js";
import { fetchStatusUncheckedRule } from "../../src/rules/network/fetchStatusUnchecked.js";
import { eventListenerCleanupRule } from "../../src/rules/browser/eventListenerCleanup.js";

describe("adversarial and security-sensitive edge case tests", () => {
  test("handles malformed package.json gracefully without crashing", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sv-malformed-pkg-"));
    try {
      await fs.writeFile(path.join(tmpDir, "package.json"), "INVALID_JSON_CONTENT{{{");
      const result = await runAudit({ targetDir: tmpDir });
      assert.ok(result !== null);
      assert.equal(result.summary.errors, 0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("handles malformed tsconfig.json gracefully without throwing unhandled exceptions", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sv-malformed-ts-"));
    try {
      await fs.writeFile(path.join(tmpDir, "package.json"), "{}");
      await fs.writeFile(path.join(tmpDir, "tsconfig.json"), "{ compilerOptions: { INVALID }");
      const result = await runAudit({ targetDir: tmpDir });
      assert.ok(result !== null);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("normalizes malicious ANSI escape characters in filenames", () => {
    const maliciousName = "src/\u001B[31mExploit\u001B[0m.ts";
    const normalized = normalizePath(maliciousName);
    const fp = computeFingerprint({
      ruleId: "typescript/unsafe-unvalidated-assertion",
      filePath: normalized,
      symbolName: "test",
    });

    assert.ok(fp.startsWith("sv_"), "Fingerprint must compute safely");
    assert.equal(fp.length, 19);
  });

  test("handles deeply nested AST expressions without recursion failure", () => {
    let deepExpr = "arr";
    for (let i = 0; i < 50; i++) {
      deepExpr = `(${deepExpr}[0])`;
    }
    const code = `const arr: unknown[] = []; const val = ${deepExpr};`;
    const findings = runRuleOnCode(fetchStatusUncheckedRule, code);
    assert.equal(Array.isArray(findings), true);
  });

  test("zero false positives when fetch is shadowed in local function parameter", () => {
    const code = `
async function customFetcher(fetch: (url: string) => Promise<Response>, url: string) {
  const res = await fetch(url);
  const data = await res.json();
  return data;
}
    `.trim();

    const findings = runRuleOnCode(fetchStatusUncheckedRule, code);
    assert.equal(findings.length, 0, "Shadowed fetch parameter must not trigger global fetch findings");
  });

  test("zero false positives when addEventListener is an unrelated object method", () => {
    const code = `
import { useEffect } from 'react';

class CustomBus {
  addEventListener(event: string, handler: Function) {}
}

function BusComponent() {
  useEffect(() => {
    const bus = new CustomBus();
    bus.addEventListener('custom', () => {});
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(eventListenerCleanupRule, code);
    // CustomBus is not a global DOM EventTarget; should produce 0 findings
    assert.equal(findings.length, 0, "Custom object addEventListener must not trigger DOM event-listener-cleanup findings");
  });
});
