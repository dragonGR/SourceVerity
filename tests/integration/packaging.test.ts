import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

describe("npm packaging, tarball integrity, and clean consumer installation", () => {
  test("builds distribution and passes verify-package test suite", async () => {
    // Ensure project is built before package verification
    await execFileAsync("npm", ["run", "build"], { cwd: process.cwd() });

    const { stdout, stderr } = await execFileAsync("node", ["scripts/verify-package.js"], {
      cwd: process.cwd(),
      timeout: 60000,
    });

    assert.ok(stdout.includes("Package verification passed with 100% success."));
  });
});
