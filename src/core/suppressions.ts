import type { Finding } from "./types.js";

export interface LineSuppression {
  readonly line: number;
  readonly ruleIds: readonly string[];
  readonly reason?: string | undefined;
}

export interface BlockSuppression {
  readonly startLine: number;
  readonly endLine?: number | undefined;
  readonly ruleIds: readonly string[];
}

export interface FileSuppressions {
  readonly nextLineSuppressions: readonly LineSuppression[];
  readonly blockSuppressions: readonly BlockSuppression[];
}

/**
 * Parses source text to identify all line and block level sourceverity suppressions.
 */
export function parseSourceSuppressions(sourceText: string): FileSuppressions {
  const lines = sourceText.split("\n");
  const nextLineSuppressions: LineSuppression[] = [];
  const blockSuppressions: BlockSuppression[] = [];

  const activeBlocks = new Map<string, number>();

  for (let i = 0; i < lines.length; i++) {
    const lineIndex = i + 1; // 1-indexed line
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    // 1. Check // sourceverity-disable-next-line <ruleIds> [-- <reason>]
    const disableNextIdx = trimmed.indexOf("sourceverity-disable-next-line");
    if (trimmed.startsWith("//") && disableNextIdx !== -1) {
      const rest = trimmed.slice(disableNextIdx + "sourceverity-disable-next-line".length).trim();
      const parts = rest.split(/\s+--\s*/);
      const rulesPart = parts[0]?.trim() ?? "";
      const reason = parts[1]?.trim();

      const ruleIds = rulesPart
        .split(",")
        .map((r) => r.trim())
        .filter((r) => r.length > 0);

      if (ruleIds.length > 0) {
        nextLineSuppressions.push({
          line: lineIndex + 1, // Target line is the NEXT line
          ruleIds,
          reason: reason || undefined,
        });
      }
      continue;
    }

    // 2. Check /* sourceverity-disable <ruleIds> */
    const blockDisableMatch = trimmed.match(/\/\*\s*sourceverity-disable\s+([^*]+)\*\//);
    if (blockDisableMatch && !trimmed.includes("sourceverity-disable-next-line")) {
      const rawRules = blockDisableMatch[1]?.trim() ?? "";
      const ruleIds = rawRules
        .split(",")
        .map((r) => r.trim())
        .filter((r) => r.length > 0);
      for (const ruleId of ruleIds) {
        activeBlocks.set(ruleId, lineIndex);
      }
      continue;
    }

    // 3. Check /* sourceverity-enable <ruleIds> */
    const blockEnableMatch = trimmed.match(/\/\*\s*sourceverity-enable\s+([^*]+)\*\//);
    if (blockEnableMatch) {
      const rawRules = blockEnableMatch[1]?.trim() ?? "";
      const ruleIds = rawRules
        .split(",")
        .map((r) => r.trim())
        .filter((r) => r.length > 0);
      for (const ruleId of ruleIds) {
        const startLine = activeBlocks.get(ruleId);
        if (startLine !== undefined) {
          blockSuppressions.push({
            startLine,
            endLine: lineIndex,
            ruleIds: [ruleId],
          });
          activeBlocks.delete(ruleId);
        }
      }
    }
  }

  // Any unclosed block suppressions extend to the end of the file
  for (const [ruleId, startLine] of activeBlocks.entries()) {
    blockSuppressions.push({
      startLine,
      endLine: undefined,
      ruleIds: [ruleId],
    });
  }

  return { nextLineSuppressions, blockSuppressions };
}

/**
 * Evaluates whether a specific finding is suppressed by comment directives.
 */
export function isFindingSuppressed(finding: Finding, suppressions: FileSuppressions): boolean {
  const line = finding.range.start.line;

  // Check next-line suppressions
  for (const supp of suppressions.nextLineSuppressions) {
    if (supp.line === line) {
      if (supp.ruleIds.includes(finding.ruleId) || supp.ruleIds.includes("all")) {
        return true;
      }
    }
  }

  // Check block suppressions
  for (const block of suppressions.blockSuppressions) {
    if (line >= block.startLine && (block.endLine === undefined || line <= block.endLine)) {
      if (block.ruleIds.includes(finding.ruleId) || block.ruleIds.includes("all")) {
        return true;
      }
    }
  }

  return false;
}
