import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeFingerprint } from "../../src/core/fingerprint.js";

describe("deterministic semantic fingerprint generator", () => {
  test("generates stable 19-char sv_ prefixed hash", () => {
    const fp1 = computeFingerprint({
      ruleId: "typescript/unsafe-unvalidated-assertion",
      filePath: "src/api/user.ts",
      enclosingScope: "getUser",
      nodeKind: 214,
      symbolName: "User",
      snippet: "JSON.parse(payload) as User",
    });

    assert.ok(fp1.startsWith("sv_"), "Fingerprint must start with sv_");
    assert.equal(fp1.length, 19, "Fingerprint must be 19 chars (sv_ + 16 hex)");

    const fp2 = computeFingerprint({
      ruleId: "typescript/unsafe-unvalidated-assertion",
      filePath: "src/api/user.ts",
      enclosingScope: "getUser",
      nodeKind: 214,
      symbolName: "User",
      snippet: "JSON.parse(payload) as User",
    });

    assert.equal(fp1, fp2, "Identical inputs must yield identical fingerprints");
  });

  test("whitespace differences in snippet are normalized", () => {
    const fp1 = computeFingerprint({
      ruleId: "react/async-effect-callback",
      filePath: "src/App.tsx",
      enclosingScope: "App",
      snippet: "useEffect(async () => {\n  await load();\n})",
    });

    const fp2 = computeFingerprint({
      ruleId: "react/async-effect-callback",
      filePath: "src/App.tsx",
      enclosingScope: "App",
      snippet: "useEffect(async () => { await load(); })",
    });

    assert.equal(fp1, fp2, "Whitespace formatting differences must not change fingerprint");
  });

  test("different files or scopes yield distinct fingerprints", () => {
    const fpA = computeFingerprint({
      ruleId: "async/async-foreach",
      filePath: "src/fileA.ts",
      enclosingScope: "processA",
    });

    const fpB = computeFingerprint({
      ruleId: "async/async-foreach",
      filePath: "src/fileB.ts",
      enclosingScope: "processB",
    });

    assert.notEqual(fpA, fpB);
  });
});
