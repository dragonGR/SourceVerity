import type { AuditResult } from "../core/types.js";

/**
 * Formats AuditResult as standard SARIF 2.1.0 log format for GitHub Code Scanning.
 */
export function renderSarifReport(result: AuditResult): string {
  const ruleMap = new Map<string, { id: string; name: string }>();

  for (const f of result.findings) {
    if (!ruleMap.has(f.ruleId)) {
      ruleMap.set(f.ruleId, { id: f.ruleId, name: f.ruleId });
    }
  }

  const sarifResults = result.findings.map((f) => {
    const level = f.severity === "error" ? "error" : f.severity === "warning" ? "warning" : "note";

    return {
      ruleId: f.ruleId,
      level,
      message: {
        text: f.message,
      },
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: f.file,
            },
            region: {
              startLine: f.range.start.line,
              startColumn: f.range.start.column,
              endLine: f.range.end.line,
              endColumn: f.range.end.column,
            },
          },
        },
      ],
      partialFingerprints: {
        primaryLocationLineHash: f.fingerprint,
      },
    };
  });

  const sarifLog = {
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "sourceverity",
            version: "1.0.0",
            rules: Array.from(ruleMap.values()).map((r) => ({
              id: r.id,
              name: r.name,
            })),
          },
        },
        results: sarifResults,
      },
    ],
  };

  return JSON.stringify(sarifLog, null, 2);
}
