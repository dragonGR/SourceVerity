import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseCliArgs } from "../../src/cli/args.js";
import { EXIT_CODES } from "../../src/cli/exitCodes.js";
import { getHelpText } from "../../src/cli/help.js";

describe("CLI argument parser and commands", () => {
  test("defaults to scan command on current directory with pretty output", () => {
    const opts = parseCliArgs([]);
    assert.equal(opts.command, "scan");
    assert.equal(opts.targetDir, ".");
    assert.equal(opts.format, "pretty");
    assert.equal(opts.minConfidence, "medium");
    assert.equal(opts.failOn, "error");
  });

  test("parses positional path with scan command", () => {
    const opts = parseCliArgs(["scan", "apps/web"]);
    assert.equal(opts.command, "scan");
    assert.equal(opts.targetDir, "apps/web");
  });

  test("parses implicit scan command with directory argument", () => {
    const opts = parseCliArgs(["./packages/ui"]);
    assert.equal(opts.command, "scan");
    assert.equal(opts.targetDir, "./packages/ui");
  });

  test("parses agent format and confidence flags", () => {
    const opts = parseCliArgs(["scan", ".", "--format", "agent", "--min-confidence", "medium", "--fail-on", "warning"]);
    assert.equal(opts.format, "agent");
    assert.equal(opts.minConfidence, "medium");
    assert.equal(opts.failOn, "warning");
  });

  test("parses explain command with rule argument", () => {
    const opts = parseCliArgs(["explain", "typescript/unsafe-unvalidated-assertion"]);
    assert.equal(opts.command, "explain");
    assert.equal(opts.ruleArg, "typescript/unsafe-unvalidated-assertion");
  });

  test("throws descriptive error when explain command is missing rule-id", () => {
    assert.throws(
      () => parseCliArgs(["explain"]),
      /Missing rule identifier for 'explain' command/
    );
  });

  test("parses baseline subcommands and update flag", () => {
    const opts = parseCliArgs(["baseline", "create", "apps/web", "-u"]);
    assert.equal(opts.command, "baseline");
    assert.equal(opts.baselineSubcommand, "create");
    assert.equal(opts.targetDir, "apps/web");
    assert.equal(opts.updateBaseline, true);
  });

  test("rejects invalid format or severity options", () => {
    assert.throws(() => parseCliArgs(["--format", "xml"]), /Invalid --format 'xml'/);
    assert.throws(() => parseCliArgs(["--min-confidence", "super"]), /Invalid --min-confidence 'super'/);
    assert.throws(() => parseCliArgs(["--fail-on", "everything"]), /Invalid --fail-on 'everything'/);
  });

  test("handles help and version flags", () => {
    const helpOpts = parseCliArgs(["-h"]);
    assert.equal(helpOpts.command, "help");
    const verOpts = parseCliArgs(["--version"]);
    assert.equal(verOpts.command, "version");
  });

  test("exit codes are standard and immutable", () => {
    assert.equal(EXIT_CODES.SUCCESS, 0);
    assert.equal(EXIT_CODES.POLICY_VIOLATION, 1);
    assert.equal(EXIT_CODES.USER_ERROR, 2);
    assert.equal(EXIT_CODES.INTERNAL_ERROR, 3);
  });

  test("help text contains all documented subcommands and flags", () => {
    const help = getHelpText();
    assert.ok(help.includes("sourceverity scan"));
    assert.ok(help.includes("strictness"));
    assert.ok(help.includes("rules"));
    assert.ok(help.includes("explain"));
    assert.ok(help.includes("baseline"));
    assert.ok(help.includes("--format"));
    assert.ok(help.includes("EXIT CODES:"));
  });
});
