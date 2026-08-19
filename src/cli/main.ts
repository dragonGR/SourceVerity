import path from "node:path";
import { parseCliArgs, type CliOptions } from "./args.js";
import { EXIT_CODES, type ExitCode } from "./exitCodes.js";
import { getHelpText } from "./help.js";
import { runAudit } from "../engine/runner.js";
import { globalRuleRegistry } from "../engine/registry.js";
import { discoverRepository } from "../repository/detector.js";
import { loadRepositoryTypeScript } from "../repository/tsLoader.js";
import { getChangedFiles } from "../repository/git.js";
import { evaluateStrictnessGap, renderStrictnessReport } from "../strictness/evaluator.js";
import {
  createBaseline,
  saveBaseline,
  loadBaseline,
  compareWithBaseline,
  DEFAULT_BASELINE_FILENAME,
} from "../baseline/manager.js";
import { renderTerminalReport } from "../reporters/terminal.js";
import { renderJsonReport } from "../reporters/json.js";
import { renderAgentReport } from "../reporters/agent.js";
import { renderSarifReport } from "../reporters/sarif.js";
import { createStyler } from "../core/terminal.js";
import { SOURCEVERITY_VERSION } from "../core/version.js";
import "../rules/index.js";

/**
 * Main CLI execution entry point.
 */
export async function runCli(argv: readonly string[]): Promise<ExitCode> {
  let options: CliOptions;
  try {
    options = parseCliArgs(argv);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`sourceverity: ${msg}\n\n${getHelpText()}\n`);
    return EXIT_CODES.USER_ERROR;
  }

  const styler = createStyler(options.color !== undefined ? { color: options.color } : undefined);

  // 1. Help command
  if (options.command === "help") {
    process.stdout.write(getHelpText() + "\n");
    return EXIT_CODES.SUCCESS;
  }

  // 2. Version command
  if (options.command === "version") {
    process.stdout.write(`${SOURCEVERITY_VERSION}\n`);
    return EXIT_CODES.SUCCESS;
  }

  // 3. Rules listing command
  if (options.command === "rules") {
    const rules = globalRuleRegistry.getAll();
    process.stdout.write(styler.bold("SourceVerity Rules\n\n"));
    for (const r of rules) {
      const paddedId = r.meta.id.padEnd(45, " ");
      const sev = r.meta.defaultSeverity.padEnd(8, " ");
      process.stdout.write(`  ${styler.bold(paddedId)} ${sev} ${styler.dim(r.meta.description)}\n`);
    }
    process.stdout.write(`\nTotal rules: ${rules.length}\n`);
    return EXIT_CODES.SUCCESS;
  }

  // 4. Explain rule command
  if (options.command === "explain") {
    const ruleId = options.ruleArg;
    const rule = ruleId ? globalRuleRegistry.get(ruleId) : undefined;
    if (!rule) {
      process.stderr.write(`sourceverity: unknown rule '${ruleId}'. Run 'sourceverity rules' to list all rules.\n`);
      return EXIT_CODES.USER_ERROR;
    }

    process.stdout.write(styler.bold(`${rule.meta.id}\n\n`));
    process.stdout.write(`${rule.meta.description}\n\n`);
    process.stdout.write(`Category:           ${rule.meta.category}\n`);
    process.stdout.write(`Default Severity:   ${rule.meta.defaultSeverity}\n`);
    process.stdout.write(`Confidence:         ${rule.meta.defaultConfidence}\n`);
    process.stdout.write(`Type Information:   ${rule.meta.requiresTypeInformation ? "required" : "syntax only"}\n`);
    return EXIT_CODES.SUCCESS;
  }

  // 5. Strictness gap analysis command
  if (options.command === "strictness") {
    const targetDir = path.resolve(options.targetDir);
    const repo = await discoverRepository(targetDir);
    const tsInst = loadRepositoryTypeScript(targetDir);

    if (!tsInst) {
      process.stderr.write(`sourceverity: strictness analysis requires a local TypeScript installation in '${targetDir}'.\n`);
      return EXIT_CODES.USER_ERROR;
    }

    const report = evaluateStrictnessGap(repo, tsInst);
    process.stdout.write(renderStrictnessReport(report, options.color !== undefined ? { color: options.color } : undefined));
    return EXIT_CODES.SUCCESS;
  }

  // 6. Baseline generation subcommand
  if (options.command === "baseline" && options.baselineSubcommand === "create") {
    const targetDir = path.resolve(options.targetDir);
    const auditResult = await runAudit({ targetDir, minConfidence: options.minConfidence });
    const baselineFile = options.baselinePath ?? path.join(targetDir, DEFAULT_BASELINE_FILENAME);

    const baseline = createBaseline(auditResult.findings, targetDir);
    await saveBaseline(baseline, baselineFile);

    process.stdout.write(`Generated baseline with ${baseline.entries.length} findings at '${baselineFile}'.\n`);
    return EXIT_CODES.SUCCESS;
  }

  // 7. Audit scan command (default)
  let changedFiles: string[] | undefined;
  if (options.changedOnly) {
    const foundChanged = await getChangedFiles(options.targetDir);
    if (foundChanged === null) {
      process.stderr.write(`sourceverity: --changed requested but '${options.targetDir}' is not a git repository.\n`);
      return EXIT_CODES.USER_ERROR;
    }
    changedFiles = foundChanged;
  }

  const result = await runAudit({
    targetDir: options.targetDir,
    minConfidence: options.minConfidence,
    changedFiles,
  });

  // Handle baseline comparison if baseline path is provided or checking baseline
  let effectiveResult = result;
  if (options.baselinePath || options.command === "baseline") {
    const baselineFile = options.baselinePath ?? path.join(path.resolve(options.targetDir), DEFAULT_BASELINE_FILENAME);
    const loadedBaseline = await loadBaseline(baselineFile);
    if (loadedBaseline) {
      const delta = compareWithBaseline(result.findings, loadedBaseline);
      effectiveResult = {
        ...result,
        findings: delta.newFindings,
      };
      if (!options.quiet && options.format === "pretty") {
        process.stdout.write(`Baseline check against '${baselineFile}': ${delta.baselineCount} baseline, ${delta.newCount} new, ${delta.resolvedCount} resolved.\n\n`);
      }
    }
  }

  if (options.updateBaseline) {
    const baselineFile = options.baselinePath ?? path.join(path.resolve(options.targetDir), DEFAULT_BASELINE_FILENAME);
    const updatedBaseline = createBaseline(result.findings, options.targetDir);
    await saveBaseline(updatedBaseline, baselineFile);
  }

  // Output formatting
  if (options.format === "pretty") {
    process.stdout.write(renderTerminalReport(effectiveResult, { color: options.color, verbose: options.verbose }));
  } else if (options.format === "json") {
    process.stdout.write(renderJsonReport(effectiveResult) + "\n");
  } else if (options.format === "agent") {
    process.stdout.write(renderAgentReport(effectiveResult) + "\n");
  } else if (options.format === "sarif") {
    process.stdout.write(renderSarifReport(effectiveResult) + "\n");
  }

  // Policy exit code evaluation
  if (options.failOn === "never") {
    return EXIT_CODES.SUCCESS;
  }

  const hasErrors = effectiveResult.findings.some((f) => f.severity === "error");
  const hasWarnings = effectiveResult.findings.some((f) => f.severity === "warning");

  if (options.failOn === "error" && hasErrors) {
    return EXIT_CODES.POLICY_VIOLATION;
  }

  if (options.failOn === "warning" && (hasErrors || hasWarnings)) {
    return EXIT_CODES.POLICY_VIOLATION;
  }

  return EXIT_CODES.SUCCESS;
}
