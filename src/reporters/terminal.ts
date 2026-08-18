import { createStyler, type TerminalStyler } from "../core/terminal.js";
import type { AuditResult, Finding, RuleCategory } from "../core/types.js";

export interface TerminalReporterOptions {
  readonly color?: boolean | undefined;
  readonly verbose?: boolean | undefined;
}

const CATEGORY_NAMES: Record<RuleCategory, string> = {
  typescript: "Type safety",
  react: "React",
  async: "Async",
  browser: "Browser",
  network: "Network",
  security: "Security",
  performance: "Performance",
  a11y: "Accessibility",
  config: "Configuration",
};

/**
 * Formats AuditResult as a clean, human-readable terminal report.
 */
export function renderTerminalReport(result: AuditResult, options?: TerminalReporterOptions | undefined): string {
  const styler = createStyler(options?.color !== undefined ? { color: options.color } : undefined);
  const lines: string[] = [];

  // 1. Header & Repository Overview
  lines.push(styler.bold("SourceVerity 1.0.0"));
  lines.push("");
  lines.push(styler.bold("Repository"));

  if (result.repository.typescriptVersion) {
    lines.push(`  TypeScript   ${result.repository.typescriptVersion}`);
  }
  if (result.repository.reactVersion) {
    lines.push(`  React        ${result.repository.reactVersion}`);
  }
  lines.push(`  Workspace    ${result.repository.workspaceType ?? result.repository.packageManager}`);
  lines.push(`  Projects     ${result.repository.projectCount}`);
  lines.push("");

  lines.push(`Analyzing ${result.summary.filesAnalyzed} source files...`);
  lines.push("");

  // 2. Category Summary Table
  const categoryCounts = new Map<RuleCategory, { errors: number; warnings: number; info: number }>();
  for (const f of result.findings) {
    const cat = f.category;
    let counts = categoryCounts.get(cat);
    if (!counts) {
      counts = { errors: 0, warnings: 0, info: 0 };
      categoryCounts.set(cat, counts);
    }
    if (f.severity === "error") counts.errors++;
    else if (f.severity === "warning") counts.warnings++;
    else if (f.severity === "info") counts.info++;
  }

  for (const [cat, name] of Object.entries(CATEGORY_NAMES) as Array<[RuleCategory, string]>) {
    const counts = categoryCounts.get(cat) ?? { errors: 0, warnings: 0, info: 0 };
    if (counts.errors > 0 || counts.warnings > 0 || counts.info > 0 || options?.verbose) {
      const paddedName = name.padEnd(16, " ");
      const errStr = counts.errors > 0 ? styler.red(`${counts.errors} error${counts.errors === 1 ? "" : "s"}`) : `0 errors`;
      const warnStr = counts.warnings > 0 ? styler.yellow(`${counts.warnings} warning${counts.warnings === 1 ? "" : "s"}`) : `0 warnings`;
      lines.push(`${paddedName}  ${errStr}   ${warnStr}`);
    }
  }

  lines.push("");

  // 3. Individual Finding Cards
  if (result.findings.length > 0) {
    for (const finding of result.findings) {
      lines.push(formatFindingCard(finding, styler));
      lines.push("");
    }
  }

  // 4. Skipped Semantic Rules Notice (if TS missing)
  if (result.skippedSemanticRules && result.skippedSemanticRules.length > 0) {
    lines.push(styler.yellow("Type-aware TypeScript analysis unavailable."));
    lines.push("No local TypeScript installation was found.");
    lines.push(`${result.skippedSemanticRules.length} semantic rules were skipped.`);
    lines.push("");
  }

  // 5. Summary Footer
  lines.push("────────────────────────────────────────");
  lines.push(`${result.summary.highConfidence} high-confidence findings`);
  if (result.summary.mediumConfidence > 0 || result.summary.lowConfidence > 0) {
    lines.push(`${result.summary.mediumConfidence + result.summary.lowConfidence} advisory findings`);
  }
  lines.push("");

  return lines.join("\n");
}

function formatFindingCard(finding: Finding, styler: TerminalStyler): string {
  const lines: string[] = [];

  const loc = `${finding.file}:${finding.range.start.line}:${finding.range.start.column}`;
  lines.push(styler.bold(loc));
  lines.push("");

  const sevStr = finding.severity === "error" ? styler.red("error") : finding.severity === "warning" ? styler.yellow("warning") : styler.dim("info");
  lines.push(`${finding.ruleId}`);
  lines.push(`${sevStr} · ${finding.confidence} confidence`);
  lines.push("");

  lines.push(finding.message);

  if (finding.evidence.length > 0) {
    lines.push("");
    for (const ev of finding.evidence) {
      lines.push(`  Evidence: ${ev.message}`);
    }
  }

  if (finding.suggestedAction) {
    lines.push("");
    lines.push(styler.dim(`  Suggested: ${finding.suggestedAction}`));
  }

  return lines.join("\n");
}
