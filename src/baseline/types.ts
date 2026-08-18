import type { Finding } from "../core/types.ts";

export interface BaselineEntry {
  readonly fingerprint: string;
  readonly ruleId: string;
  readonly file: string;
  readonly message: string;
}

export interface BaselineFile {
  readonly version: 1;
  readonly generatedAt: string;
  readonly repositoryRoot: string;
  readonly entries: readonly BaselineEntry[];
}

export interface BaselineDelta {
  readonly newFindings: readonly Finding[];
  readonly baselineCount: number;
  readonly resolvedCount: number;
  readonly newCount: number;
}
