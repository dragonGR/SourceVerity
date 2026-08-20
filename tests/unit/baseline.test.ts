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
  test("newly created baseline contains no absolute machine path and uses portable root marker", () => {
    const baseline = createBaseline([sampleFinding1, sampleFinding2], "/home/alex/Projects/my-app");
    assert.equal(baseline.repositoryRoot, ".");
    assert.ok(!baseline.entries.some((e) => e.file.startsWith("/")));
    assert.ok(!baseline.entries.some((e) => e.file.includes("\\")));
  });

  test("baseline created in two different temporary directory roots is semantically equivalent", () => {
    const findingInRootA: Finding = {
      ...sampleFinding1,
      file: "/tmp/rootA/src/api.ts",
    };
    const findingInRootB: Finding = {
      ...sampleFinding1,
      file: "/private/var/folders/rootB/src/api.ts",
    };

    const baselineA = createBaseline([findingInRootA], "/tmp/rootA");
    const baselineB = createBaseline([findingInRootB], "/private/var/folders/rootB");

    assert.equal(baselineA.repositoryRoot, ".");
    assert.equal(baselineB.repositoryRoot, ".");
    assert.equal(baselineA.entries.length, 1);
    assert.equal(baselineB.entries.length, 1);
    assert.equal(baselineA.entries[0]?.file, "src/api.ts");
    assert.equal(baselineB.entries[0]?.file, "src/api.ts");
    assert.equal(baselineA.entries[0]?.fingerprint, baselineB.entries[0]?.fingerprint);
  });

  test("legacy baseline with absolute repositoryRoot still loads and performs delta comparison", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sv-legacy-baseline-"));
    const legacyPath = path.join(tmpDir, ".sourceverity-baseline.json");

    const legacyJson = JSON.stringify({
      version: 1,
      generatedAt: "2026-01-01T00:00:00.000Z",
      repositoryRoot: "/home/alex/legacy/machine/path",
      entries: [
        {
          fingerprint: "sv_aaa111",
          ruleId: "async/floating-promise",
          file: "src/api.ts",
          message: "Floating promise",
        },
      ],
    });

    try {
      await fs.writeFile(legacyPath, legacyJson, "utf-8");
      const loaded = await loadBaseline(legacyPath);
      assert.ok(loaded !== null);
      assert.equal(loaded.entries.length, 1);

      const delta = compareWithBaseline([sampleFinding1], loaded);
      assert.equal(delta.baselineCount, 1);
      assert.equal(delta.newCount, 0);
      assert.equal(delta.resolvedCount, 0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
