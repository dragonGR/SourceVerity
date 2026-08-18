import { test, describe } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getChangedFiles } from "../../src/repository/git.js";

const execFileAsync = promisify(execFile);

describe("git changed files discovery", () => {
  test("queries changed files in initialized git repository", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sv-git-test-"));
    try {
      await execFileAsync("git", ["init"], { cwd: tmpDir });
      await fs.writeFile(path.join(tmpDir, "file1.ts"), "const x = 1;");

      const changed = await getChangedFiles(tmpDir);
      assert.ok(Array.isArray(changed), "getChangedFiles should return an array for git repo");
      assert.ok(changed.includes("file1.ts"));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("returns null gracefully for non-git directories without throwing", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sv-no-git-"));
    try {
      const changed = await getChangedFiles(tmpDir);
      assert.equal(changed, null);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
