import path from "node:path";
import type * as tsType from "typescript";
import { normalizePath } from "../core/paths.js";
import { createStyler } from "../core/terminal.js";
import { resolveTsProjects } from "../typescript/projectResolver.js";
import { STRICTNESS_FLAGS } from "./matrix.js";
import type { RepositoryContext } from "../repository/types.js";
import type { TypeScriptInstance } from "../repository/tsLoader.js";

export interface StrictnessFlagStatus {
  readonly name: string;
  readonly enabled: boolean;
  readonly potentialDiagnosticCount: number;
}

export interface StrictnessReport {
  readonly currentFlags: readonly StrictnessFlagStatus[];
  readonly topAffectedFiles: ReadonlyArray<{ readonly file: string; readonly diagnostics: number }>;
  readonly totalMigrationImpact: number;
}

/**
 * Generates a stable semantic identity key for a compiler diagnostic.
 */
function getDiagnosticSemanticKey(diag: tsType.Diagnostic, repoRoot: string): string {
  const fileKey = diag.file ? normalizePath(diag.file.fileName, repoRoot) : "<global>";
  const start = diag.start ?? -1;
  const length = diag.length ?? -1;
  const code = diag.code;
  const message =
    typeof diag.messageText === "string"
      ? diag.messageText
      : diag.messageText?.messageText ?? "";
  return `${fileKey}::${code}::${start}::${length}::${message}`;
}

/**
 * Runs strictness gap analysis using the repository's TypeScript compiler.
 * Compares derived compiler diagnostics against current baseline diagnostics
 * to count only newly introduced migration issues.
 */
export function evaluateStrictnessGap(
  repo: RepositoryContext,
  tsInst: TypeScriptInstance
): StrictnessReport {
  const ts = tsInst.ts;
  const projects = resolveTsProjects(repo, tsInst);
  const flagResults: StrictnessFlagStatus[] = [];
  const fileDiagnosticCounts = new Map<string, number>();

  // 1. Gather baseline diagnostics per project under current repository settings
  const projectBaselineKeys = new Map<string, Set<string>>();
  for (const proj of projects) {
    if (proj.fileNames.length === 0) continue;

    const baseHost = ts.createCompilerHost(proj.rawCompilerOptions, true);
    const baseProgram = ts.createProgram({
      rootNames: proj.fileNames,
      options: proj.rawCompilerOptions,
      host: baseHost,
    });

    const baseDiagnostics = baseProgram.getSemanticDiagnostics();
    const baseKeys = new Set<string>();
    for (const diag of baseDiagnostics) {
      baseKeys.add(getDiagnosticSemanticKey(diag, repo.rootDir));
    }
    projectBaselineKeys.set(proj.configPath, baseKeys);
  }

  let totalImpact = 0;

  // 2. Evaluate migration impact for each strictness flag individually
  for (const flagDef of STRICTNESS_FLAGS) {
    const key = flagDef.compilerKey;
    let isGloballyEnabled = true;
    let flagDeltaCount = 0;

    for (const proj of projects) {
      if (proj.fileNames.length === 0) continue;

      const opts = proj.rawCompilerOptions;
      // In TypeScript, strict: true enables several sub-flags if not explicitly false
      const currentVal = Boolean(opts[key as keyof tsType.CompilerOptions]);

      if (!currentVal) {
        isGloballyEnabled = false;

        // Create derived in-memory compiler options
        const derivedOptions: tsType.CompilerOptions = {
          ...opts,
          [key]: true,
        };

        const host = ts.createCompilerHost(derivedOptions, true);
        const derivedProgram = ts.createProgram({
          rootNames: proj.fileNames,
          options: derivedOptions,
          host,
        });

        const allDiagnostics = derivedProgram.getSemanticDiagnostics();
        const baseKeys = projectBaselineKeys.get(proj.configPath) ?? new Set<string>();

        // Only count diagnostics that are NEWLY introduced by enabling this flag
        const newDiagnostics = allDiagnostics.filter(
          (diag) => !baseKeys.has(getDiagnosticSemanticKey(diag, repo.rootDir))
        );

        flagDeltaCount += newDiagnostics.length;

        for (const diag of newDiagnostics) {
          if (diag.file) {
            const relFile = normalizePath(diag.file.fileName, repo.rootDir);
            fileDiagnosticCounts.set(relFile, (fileDiagnosticCounts.get(relFile) ?? 0) + 1);
          }
        }
      }
    }

    totalImpact += flagDeltaCount;
    flagResults.push({
      name: flagDef.name,
      enabled: isGloballyEnabled,
      potentialDiagnosticCount: flagDeltaCount,
    });
  }

  // Sort top affected files descending
  const topAffectedFiles = Array.from(fileDiagnosticCounts.entries())
    .map(([file, diagnostics]) => ({ file, diagnostics }))
    .sort((a, b) => b.diagnostics - a.diagnostics)
    .slice(0, 10);

  return {
    currentFlags: flagResults,
    topAffectedFiles,
    totalMigrationImpact: totalImpact,
  };
}

/**
 * Formats a StrictnessReport for terminal output.
 */
export function renderStrictnessReport(
  report: StrictnessReport,
  options?: { readonly color?: boolean | undefined } | undefined
): string {
  const styler = createStyler(options?.color !== undefined ? { color: options.color } : undefined);
  const lines: string[] = [];

  lines.push(styler.bold("TypeScript strictness gap"));
  lines.push("");
  lines.push("Current configuration:");
  lines.push("");

  for (const flag of report.currentFlags) {
    const paddedName = flag.name.padEnd(30, " ");
    const status = flag.enabled ? styler.green("true") : styler.dim("false");
    lines.push(`  ${paddedName} ${status}`);
  }

  lines.push("");
  lines.push("Potential migration impact:");
  lines.push("");

  for (const flag of report.currentFlags) {
    if (!flag.enabled) {
      const paddedName = flag.name.padEnd(30, " ");
      const countStr =
        flag.potentialDiagnosticCount > 0
          ? styler.yellow(`${flag.potentialDiagnosticCount} findings`)
          : "0 findings";
      lines.push(`  ${paddedName}  ${countStr}`);
    }
  }

  if (report.topAffectedFiles.length > 0) {
    lines.push("");
    lines.push("Most affected files:");
    lines.push("");
    for (const f of report.topAffectedFiles) {
      const paddedFile = f.file.padEnd(32, " ");
      lines.push(`  ${paddedFile}  ${f.diagnostics}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}
