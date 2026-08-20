import type { AuditResult } from "../core/types.js";
import { SOURCEVERITY_VERSION } from "../core/version.js";
import { globalRuleRegistry } from "../engine/registry.js";
import "../rules/index.js";

interface SarifRuleDescriptor {
  readonly id: string;
  readonly name: string;
  readonly shortDescription: { readonly text: string };
  readonly defaultConfiguration?: { readonly level: "error" | "warning" | "note" } | undefined;
}

/**
 * Formats AuditResult as standard SARIF 2.1.0 log format for GitHub Code Scanning.
 * Populates driver.rules from the authoritative rule registry with descriptions and default configurations.
 */
export function renderSarifReport(result: AuditResult): string {
  const allRules = globalRuleRegistry.getAll();
  const rulesMap = new Map<string, SarifRuleDescriptor>();

  for (const r of allRules) {
    const defaultLevel =
      r.meta.defaultSeverity === "error"
        ? "error"
        : r.meta.defaultSeverity === "warning"
        ? "warning"
        : "note";

    rulesMap.set(r.meta.id, {
      id: r.meta.id,
      name: r.meta.id,
      shortDescription: {
        text: r.meta.description,
      },
      defaultConfiguration: {
        level: defaultLevel,
      },
    });
  }

  // Ensure any custom rule present in findings is also represented
  for (const f of result.findings) {
    if (!rulesMap.has(f.ruleId)) {
      const defaultLevel =
        f.severity === "error" ? "error" : f.severity === "warning" ? "warning" : "note";
      rulesMap.set(f.ruleId, {
        id: f.ruleId,
        name: f.ruleId,
        shortDescription: {
          text: f.ruleId,
        },
        defaultConfiguration: {
          level: defaultLevel,
        },
      });
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
            version: SOURCEVERITY_VERSION,
            rules: Array.from(rulesMap.values()),
          },
        },
        results: sarifResults,
      },
    ],
  };

  return JSON.stringify(sarifLog, null, 2);
}
