import fs from "node:fs/promises";
import path from "node:path";
import { normalizePath } from "../core/paths.js";
import type { Finding } from "../core/types.js";
import type { BaselineEntry, BaselineFile, BaselineDelta } from "./types.js";

export const DEFAULT_BASELINE_FILENAME = ".sourceverity-baseline.json";

/**
 * Creates a BaselineFile structure from a list of audit findings.
 */
export function createBaseline(findings: readonly Finding[], repoRoot: string): BaselineFile {
  const entriesMap = new Map<string, BaselineEntry>();

  for (const f of findings) {
    if (!entriesMap.has(f.fingerprint)) {
      entriesMap.set(f.fingerprint, {
        fingerprint: f.fingerprint,
        ruleId: f.ruleId,
        file: normalizePath(f.file, repoRoot),
        message: f.message,
      });
    }
  }

  const entries = Array.from(entriesMap.values()).sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    repositoryRoot: ".",
    entries,
  };
}

/**
 * Atomically writes a baseline file to disk.
 */
export async function saveBaseline(baseline: BaselineFile, filePath: string): Promise<void> {
  const resolvedPath = path.resolve(filePath);
  const dir = path.dirname(resolvedPath);
  await fs.mkdir(dir, { recursive: true });

  const tempPath = `${resolvedPath}.${Date.now()}.tmp`;
  const serialized = JSON.stringify(baseline, null, 2);

  await fs.writeFile(tempPath, serialized, "utf-8");
  await fs.rename(tempPath, resolvedPath);
}

/**
 * Loads and validates a baseline file from disk. Returns null if missing or malformed.
 */
export async function loadBaseline(filePath: string): Promise<BaselineFile | null> {
  try {
    const raw = await fs.readFile(path.resolve(filePath), "utf-8");
    // sourceverity-disable-next-line typescript/unsafe-unvalidated-assertion -- validated by version and entries checks below
    const parsed = JSON.parse(raw) as BaselineFile;
    if (parsed && parsed.version === 1 && Array.isArray(parsed.entries)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Compares current audit findings against a baseline to determine new and resolved findings.
 */
export function compareWithBaseline(
  currentFindings: readonly Finding[],
  baseline: BaselineFile
): BaselineDelta {
  const baselineFingerprints = new Set(baseline.entries.map((e) => e.fingerprint));
  const currentFingerprints = new Set(currentFindings.map((f) => f.fingerprint));

  const newFindings = currentFindings.filter((f) => !baselineFingerprints.has(f.fingerprint));

  let resolvedCount = 0;
  for (const fp of baselineFingerprints) {
    if (!currentFingerprints.has(fp)) {
      resolvedCount++;
    }
  }

  return {
    newFindings,
    baselineCount: baseline.entries.length,
    resolvedCount,
    newCount: newFindings.length,
  };
}
