import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { runCli } from "../../src/cli/main.js";
import { EXIT_CODES } from "../../src/cli/exitCodes.js";
import { SOURCEVERITY_VERSION } from "../../src/core/version.js";

describe("CLI main execution and subcommands", () => {
  const fixturesDir = path.resolve(process.cwd(), "tests/fixtures");

  test("runs version command cleanly with exit code 0", async () => {
    const code = await runCli(["--version"]);
    assert.equal(code, EXIT_CODES.SUCCESS);
  });

  test("runs help command cleanly with exit code 0", async () => {
    const code = await runCli(["--help"]);
    assert.equal(code, EXIT_CODES.SUCCESS);
  });

  test("runs rules command listing all built-in rules", async () => {
    const code = await runCli(["rules"]);
    assert.equal(code, EXIT_CODES.SUCCESS);
  });

  test("runs explain command for valid rule", async () => {
    const code = await runCli(["explain", "async/async-foreach"]);
    assert.equal(code, EXIT_CODES.SUCCESS);
  });

  test("returns USER_ERROR exit code for unknown explain rule", async () => {
    const code = await runCli(["explain", "non-existent-rule"]);
    assert.equal(code, EXIT_CODES.USER_ERROR);
  });

  test("runs scan on basic-ts fixture cleanly", async () => {
    const basicTsDir = path.join(fixturesDir, "basic-ts");
    const code = await runCli(["scan", basicTsDir, "--format", "json"]);
    assert.equal(code, EXIT_CODES.SUCCESS);
  });

  test("runs strictness on loose-ts fixture", async () => {
    const looseTsDir = path.join(fixturesDir, "loose-ts");
    const code = await runCli(["strictness", looseTsDir]);
    assert.equal(code, EXIT_CODES.SUCCESS);
  });
});

describe("CLI operating-system subprocess execution and exit codes", () => {
  const fixturesDir = path.resolve(process.cwd(), "tests/fixtures");
  const binPath = path.resolve(process.cwd(), "bin/sourceverity.js");

  function runSubprocess(args: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      execFile(process.execPath, [binPath, ...args], { cwd: process.cwd() }, (error, stdout, stderr) => {
        const code = error && typeof error.code === "number" ? error.code : 0;
        resolve({ code, stdout, stderr });
      });
    });
  }

  test("sourceverity --version subprocess exits with 0", async () => {
    const { code, stdout } = await runSubprocess(["--version"]);
    assert.equal(code, 0);
    assert.equal(stdout.trim(), SOURCEVERITY_VERSION);
  });

  test("sourceverity --help subprocess exits with 0", async () => {
    const { code, stdout } = await runSubprocess(["--help"]);
    assert.equal(code, 0);
    assert.ok(stdout.includes("USAGE:"));
  });

  test("successful clean scan subprocess exits with 0", async () => {
    const basicTsDir = path.join(fixturesDir, "basic-ts");
    const { code, stdout } = await runSubprocess(["scan", basicTsDir, "--format", "json"]);
    assert.equal(code, 0);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.findings.length, 0);
  });

  test("scan violating configured failure policy subprocess exits with 1", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sv-policy-violation-"));
    try {
      await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
      await fs.mkdir(path.join(tmpDir, "node_modules"), { recursive: true });
      const localTs = path.resolve(process.cwd(), "node_modules/typescript");
      try {
        await fs.symlink(localTs, path.join(tmpDir, "node_modules", "typescript"), "dir");
      } catch {
        // Fallback
      }

      await fs.writeFile(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ name: "violation-fixture", version: "1.0.0" }, null, 2)
      );
      await fs.writeFile(
        path.join(tmpDir, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext" }, include: ["src/**/*"] }, null, 2)
      );
      // Code violating async/async-foreach rule (severity: error)
      await fs.writeFile(
        path.join(tmpDir, "src", "index.ts"),
        "export function run(items: number[]) {\n  items.forEach(async (x) => { await Promise.resolve(x); });\n}\n"
      );

      const { code } = await runSubprocess(["scan", tmpDir, "--fail-on", "error"]);
      assert.equal(code, 1, "Policy violation scan must exit with code 1");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("invalid command/argument subprocess exits with 2", async () => {
    const { code, stderr } = await runSubprocess(["--non-existent-option"]);
    assert.equal(code, 2, "Invalid argument must exit with code 2");
    assert.ok(stderr.includes("Unknown option"));
  });

  test("sourceverity explain non-existent-rule subprocess exits with 2", async () => {
    const { code, stderr } = await runSubprocess(["explain", "non-existent-rule"]);
    assert.equal(code, 2, "Unknown rule explain must exit with code 2");
    assert.ok(stderr.includes("unknown rule"));
  });
});
