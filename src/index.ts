import path from "node:path";
import { runAudit, type RunAuditOptions } from "./engine/runner.js";
import { discoverRepository } from "./repository/detector.js";
import { loadRepositoryTypeScript } from "./repository/tsLoader.js";
import { evaluateStrictnessGap, type StrictnessReport, type StrictnessFlagStatus } from "./strictness/evaluator.js";
export interface ScanOptions {
  readonly targetDir?: string | undefined;
  readonly minConfidence?: "high" | "medium" | "low" | undefined;
  readonly customIgnores?: readonly string[] | undefined;
  readonly changedFiles?: readonly string[] | undefined;
}

/**
 * Programmatic entrypoint to scan a repository for correctness and quality defects.
 */
export async function scanRepository(options?: ScanOptions | undefined) {
  const targetDir = options?.targetDir ?? process.cwd();
  const auditOpts: RunAuditOptions = {
    targetDir,
    minConfidence: options?.minConfidence ?? "high",
    customIgnores: options?.customIgnores,
    changedFiles: options?.changedFiles,
  };
  return runAudit(auditOpts);
}

/**
 * Programmatic entrypoint to run strictness gap analysis on a repository's TypeScript configuration.
 */
export async function evaluateStrictness(targetDir = process.cwd()): Promise<StrictnessReport> {
  const resolvedTarget = path.resolve(targetDir);
  const repo = await discoverRepository(resolvedTarget);
  const tsInst = loadRepositoryTypeScript(resolvedTarget);

  if (!tsInst) {
    throw new Error(`TypeScript is not installed in target project: '${resolvedTarget}'`);
  }

  return evaluateStrictnessGap(repo, tsInst);
}
export type { StrictnessReport, StrictnessFlagStatus };
export type * from "./core/types.js";
export type * from "./baseline/types.js";
export { createBaseline, compareWithBaseline, loadBaseline, saveBaseline } from "./baseline/manager.js";
