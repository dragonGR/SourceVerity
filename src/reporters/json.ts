import type { AuditResult } from "../core/types.js";

/**
 * Formats AuditResult as structured JSON.
 */
export function renderJsonReport(result: AuditResult): string {
  return JSON.stringify(result, null, 2);
}
