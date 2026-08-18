import { createHash } from "node:crypto";

export interface FingerprintInput {
  readonly ruleId: string;
  readonly filePath: string;
  readonly enclosingScope?: string;
  readonly nodeKind?: string | number;
  readonly symbolName?: string;
  readonly snippet?: string;
  readonly extraKey?: string;
}

/**
 * Computes a deterministic, semantic-first finding fingerprint.
 *
 * Uses SHA-256 digest truncated to 16 hex characters prefixed with "sv_".
 * Deliberately excludes volatile source line/column numbers to maintain
 * baseline identity when unrelated code edits occur above the finding.
 */
export function computeFingerprint(input: FingerprintInput): string {
  const normalizedPath = input.filePath.replace(/\\/g, "/");
  const normalizedSnippet = (input.snippet ?? "")
    .replace(/\s+/g, " ")
    .trim();

  const payload = [
    input.ruleId,
    normalizedPath,
    input.enclosingScope ?? "global",
    String(input.nodeKind ?? ""),
    input.symbolName ?? "",
    normalizedSnippet,
    input.extraKey ?? "",
  ].join("::");

  const hash = createHash("sha256").update(payload, "utf-8").digest("hex").slice(0, 16);
  return `sv_${hash}`;
}
