import type { AuditResult, Finding } from "../core/types.js";
import { SOURCEVERITY_VERSION } from "../core/version.js";

export interface AgentFinding {
  readonly fingerprint: string;
  readonly ruleId: string;
  readonly category: string;
  readonly severity: string;
  readonly confidence: string;
  readonly file: string;
  readonly range: {
    readonly start: { readonly line: number; readonly column: number };
    readonly end: { readonly line: number; readonly column: number };
  };
  readonly message: string;
  readonly evidence: readonly string[];
  readonly suggestedAction: string | null;
  readonly safeAutomaticFix: boolean;
}

export interface AgentReport {
  readonly schemaVersion: 1;
  readonly tool: {
    readonly name: "sourceverity";
    readonly version: string;
  };
  readonly repository: {
    readonly typescript?: string | undefined;
    readonly react?: string | undefined;
  };
  readonly summary: {
    readonly errors: number;
    readonly warnings: number;
    readonly info: number;
  };
  readonly findings: readonly AgentFinding[];
}

/**
 * Formats AuditResult into structured Agent JSON format for LLMs/Codex.
 */
export function renderAgentReport(result: AuditResult): string {
  const agentFindings: AgentFinding[] = result.findings.map((f: Finding) => ({
    fingerprint: f.fingerprint,
    ruleId: f.ruleId,
    category: f.category,
    severity: f.severity,
    confidence: f.confidence,
    file: f.file,
    range: {
      start: { line: f.range.start.line, column: f.range.start.column },
      end: { line: f.range.end.line, column: f.range.end.column },
    },
    message: f.message,
    evidence: f.evidence.map((e) => e.message),
    suggestedAction: f.suggestedAction ?? null,
    safeAutomaticFix: f.safeAutomaticFix,
  }));

  const report: AgentReport = {
    schemaVersion: 1,
    tool: {
      name: "sourceverity",
      version: SOURCEVERITY_VERSION,
    },
    repository: {
      typescript: result.repository.typescriptVersion,
      react: result.repository.reactVersion,
    },
    summary: {
      errors: result.summary.errors,
      warnings: result.summary.warnings,
      info: result.summary.info,
    },
    findings: agentFindings,
  };

  return JSON.stringify(report, null, 2);
}
