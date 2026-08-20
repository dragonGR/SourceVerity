import path from "node:path";
import { normalizePath } from "../core/paths.js";
import { computeFingerprint } from "../core/fingerprint.js";
import { parseSourceSuppressions, isFindingSuppressed } from "../core/suppressions.js";
import { discoverRepository } from "../repository/detector.js";
import { loadRepositoryTypeScript } from "../repository/tsLoader.js";
import { createFileFilter } from "../repository/fileFilter.js";
import { resolveTsProjects } from "../typescript/projectResolver.js";
import { createProjectPrograms } from "../typescript/programManager.js";
import { createRuleContext } from "./context.js";
import { globalRuleRegistry } from "./registry.js";
import "../rules/index.js";
import type {
  Finding,
  FindingInput,
  Confidence,
  Severity,
  AuditResult,
  AuditSummary,
  RepositorySummary,
  Rule,
} from "../core/types.js";

export interface RunAuditOptions {
  readonly targetDir: string;
  readonly minConfidence?: "high" | "medium" | "low" | undefined;
  readonly rules?: readonly Rule[] | undefined;
  readonly customIgnores?: readonly string[] | undefined;
  readonly changedFiles?: readonly string[] | undefined;
}

const SEVERITY_ORDER: Record<Severity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

const CONFIDENCE_LEVELS: Record<Confidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Executes a full SourceVerity audit across the target repository.
 */
export async function runAudit(options: RunAuditOptions): Promise<AuditResult> {
  const resolvedTarget = path.resolve(options.targetDir);
  const minConfidence = options.minConfidence ?? "medium";
  const minConfidenceLevel = CONFIDENCE_LEVELS[minConfidence];
  // 1. Discover repository structure and frameworks
  const repoContext = await discoverRepository(resolvedTarget);
  const fileFilter = await createFileFilter(resolvedTarget, options.customIgnores);

  // 2. Load repository TypeScript compiler
  const tsInst = loadRepositoryTypeScript(resolvedTarget);
  const skippedSemanticRules: string[] = [];

  const rawFindings: Finding[] = [];
  const rulesToRun = options.rules ?? globalRuleRegistry.getAll();
  const analyzedFiles = new Set<string>();

  if (tsInst) {
    // 3. Resolve TypeScript projects and create programs
    const projects = resolveTsProjects(repoContext, tsInst);
    const projectPrograms = createProjectPrograms(projects, tsInst, fileFilter);

    for (const projectProg of projectPrograms) {
      for (const sf of projectProg.sourceFiles) {
        const normalizedRelPath = normalizePath(sf.fileName, resolvedTarget);
        if (options.changedFiles && options.changedFiles.length > 0) {
          if (!options.changedFiles.includes(normalizedRelPath)) {
            continue;
          }
        }

        analyzedFiles.add(sf.fileName);
        const suppressions = parseSourceSuppressions(sf.text);

        for (const rule of rulesToRun) {
          const context = createRuleContext({
            ts: tsInst.ts,
            program: projectProg.program,
            checker: projectProg.checker,
            sourceFile: sf,
            repoContext,
            projectRoot: projectProg.projectRoot,
            reportFinding(input: FindingInput) {
              const fingerprint =
                input.fingerprint ??
                computeFingerprint({
                  ruleId: input.ruleId,
                  filePath: input.file,
                  symbolName: input.message,
                  snippet: sf.text.slice(
                    sf.getPositionOfLineAndCharacter(input.range.start.line - 1, input.range.start.column - 1),
                    sf.getPositionOfLineAndCharacter(input.range.end.line - 1, input.range.end.column - 1)
                  ),
                });

              const completeFinding: Finding = {
                ...input,
                fingerprint,
                file: normalizePath(input.file, resolvedTarget),
              };
              // Filter out suppressed findings
              if (!isFindingSuppressed(completeFinding, suppressions)) {
                // Filter out findings below confidence threshold
                if (CONFIDENCE_LEVELS[completeFinding.confidence] >= minConfidenceLevel) {
                  rawFindings.push(completeFinding);
                }
              }
            },
          });

          void rule.analyze(context);
        }
      }
    }
  } else {
    // Record semantic rules as skipped if TypeScript is unavailable
    for (const rule of rulesToRun) {
      if (rule.meta.requiresTypeInformation) {
        skippedSemanticRules.push(rule.meta.id);
      }
    }
  }

  // 4. Deduplicate findings across multi-project programs by exact semantic identity
  const seenFindingKeys = new Set<string>();
  const deduplicatedFindings: Finding[] = [];

  for (const f of rawFindings) {
    const key = `${f.file}:${f.range.start.line}:${f.range.start.column}:${f.range.end.line}:${f.range.end.column}:${f.ruleId}:${f.fingerprint}`;
    if (!seenFindingKeys.has(key)) {
      seenFindingKeys.add(key);
      deduplicatedFindings.push(f);
    }
  }

  // 5. Sort findings strictly and deterministically
  const sortedFindings = deduplicatedFindings.sort((a, b) => {
    // 1. File path ASC
    const fileCmp = a.file.localeCompare(b.file);
    if (fileCmp !== 0) return fileCmp;

    // 2. Line ASC
    const lineCmp = a.range.start.line - b.range.start.line;
    if (lineCmp !== 0) return lineCmp;

    // 3. Column ASC
    const colCmp = a.range.start.column - b.range.start.column;
    if (colCmp !== 0) return colCmp;

    // 4. Severity (error < warning < info)
    const sevCmp = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sevCmp !== 0) return sevCmp;

    // 5. Rule ID ASC
    const ruleCmp = a.ruleId.localeCompare(b.ruleId);
    if (ruleCmp !== 0) return ruleCmp;

    // 6. Fingerprint ASC
    return a.fingerprint.localeCompare(b.fingerprint);
  });

  // 6. Build authoritative summary
  const summary = computeAuditSummary(
    sortedFindings,
    analyzedFiles.size,
    repoContext.packages.length || 1
  );
  const repositorySummary: RepositorySummary = {
    typescriptVersion: tsInst?.version,
    reactVersion: repoContext.reactVersion,
    packageManager: repoContext.packageManager,
    projectCount: repoContext.packages.length || 1,
    workspaceType: repoContext.workspaceType,
  };

  return {
    findings: sortedFindings,
    summary,
    repository: repositorySummary,
    skippedSemanticRules: skippedSemanticRules.length > 0 ? skippedSemanticRules : undefined,
  };
}

/**
 * Derives a consistent, authoritative AuditSummary from an effective list of findings
 * while preserving repository-level scan statistics (filesAnalyzed, projectsCount).
 */
export function computeAuditSummary(
  findings: readonly Finding[],
  filesAnalyzed: number,
  projectsCount: number
): AuditSummary {
  let errors = 0;
  let warnings = 0;
  let info = 0;
  let highConfidence = 0;
  let mediumConfidence = 0;
  let lowConfidence = 0;

  for (const f of findings) {
    if (f.severity === "error") errors++;
    else if (f.severity === "warning") warnings++;
    else if (f.severity === "info") info++;

    if (f.confidence === "high") highConfidence++;
    else if (f.confidence === "medium") mediumConfidence++;
    else if (f.confidence === "low") lowConfidence++;
  }

  return {
    errors,
    warnings,
    info,
    highConfidence,
    mediumConfidence,
    lowConfidence,
    filesAnalyzed,
    projectsCount,
  };
}
