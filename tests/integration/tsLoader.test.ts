import { test, describe } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { loadRepositoryTypeScript } from "../../src/repository/tsLoader.js";

describe("repository typescript dynamic loader", () => {
  test("resolves and loads typescript from repository root", () => {
    const tsInst = loadRepositoryTypeScript(process.cwd());
    assert.ok(tsInst !== null, "TypeScript should be loaded from current working directory");
    assert.ok(typeof tsInst.ts.createProgram === "function", "ts.createProgram should exist");
    assert.ok(tsInst.version.length > 0, "TypeScript version should be non-empty");
    assert.equal(tsInst.isLocal, true);
  });

  test("returns null gracefully when target repository has no typescript installed", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sv-no-ts-"));
    try {
      const tsInst = loadRepositoryTypeScript(tmpDir);
      assert.equal(tsInst, null, "Should return null when typescript is not found");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
