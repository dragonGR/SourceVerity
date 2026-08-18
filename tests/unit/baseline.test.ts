import { test, describe } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import {
  createBaseline,
  saveBaseline,
  loadBaseline,
  compareWithBaseline,
} from "../../src/baseline/manager.js";
import type { Finding } from "../../src/core/types.js";

describe("baseline manager and delta comparator", () => {
  const sampleFinding1: Finding = {
    fingerprint: "sv_aaa111",
    ruleId: "async/floating-promise",
    category: "async",
    severity: "error",
    confidence: "high",
    message: "Floating promise",
    file: "src/api.ts",
    range: { start: { line: 1, column: 1 }, end: { line: 1, column: 10 } },
    evidence: [],
    safeAutomaticFix: false,
  };

  const sampleFinding2: Finding = {
    fingerprint: "sv_bbb222",
    ruleId: "typescript/non-null-assertion-risk",
    category: "typescript",
    severity: "warning",
    confidence: "high",
    message: "Nullable assertion",
    file: "src/user.ts",
    range: { start: { line: 5, column: 1 }, end: { line: 5, column: 10 } },
    evidence: [],
    safeAutomaticFix: false,
  };

  const newFinding3: Finding = {
    fingerprint: "sv_ccc333",
    ruleId: "react/async-effect-callback",
    category: "react",
    severity: "error",
    confidence: "high",
    message: "Async effect",
    file: "src/App.tsx",
    range: { start: { line: 10, column: 1 }, end: { line: 10, column: 10 } },
    evidence: [],
    safeAutomaticFix: false,
  };

  test("creates baseline and performs delta comparison", () => {
    const baseline = createBaseline([sampleFinding1, sampleFinding2], "/repo");
    assert.equal(baseline.entries.length, 2);

    // Scan has finding2 and newFinding3 (finding1 was resolved!)
    const currentScan = [sampleFinding2, newFinding3];
    const delta = compareWithBaseline(currentScan, baseline);

    assert.equal(delta.baselineCount, 2);
    assert.equal(delta.newCount, 1);
    assert.equal(delta.newFindings[0]?.fingerprint, "sv_ccc333");
    assert.equal(delta.resolvedCount, 1); // finding1 was fixed
  });

  test("atomic save and load round-trip", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sv-baseline-"));
    const baselinePath = path.join(tmpDir, ".sourceverity-baseline.json");

    try {
      const baseline = createBaseline([sampleFinding1], tmpDir);
      await saveBaseline(baseline, baselinePath);

      const loaded = await loadBaseline(baselinePath);
      assert.ok(loaded !== null);
      assert.equal(loaded.entries.length, 1);
      assert.equal(loaded.entries[0]?.fingerprint, "sv_aaa111");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
