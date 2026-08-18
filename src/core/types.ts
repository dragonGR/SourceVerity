import type * as ts from "typescript";

export type Severity = "error" | "warning" | "info";

export type Confidence = "high" | "medium" | "low";

export type RuleCategory =
  | "typescript"
  | "react"
  | "async"
  | "browser"
  | "network"
  | "security"
  | "performance"
  | "a11y"
  | "config";

export interface SourcePosition {
  readonly line: number;
  readonly column: number;
}

export interface SourceRange {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export interface Evidence {
  readonly message: string;
  readonly range?: SourceRange | undefined;
}

export interface Finding {
  readonly fingerprint: string;
  readonly ruleId: string;
  readonly category: RuleCategory;
  readonly severity: Severity;
  readonly confidence: Confidence;
  readonly message: string;
  readonly file: string;
  readonly projectRoot?: string | undefined;
  readonly range: SourceRange;
  readonly evidence: readonly Evidence[];
  readonly suggestedAction?: string | null | undefined;
  readonly safeAutomaticFix: boolean;
  readonly repositoryAccepted?: boolean | undefined;
}

export type FindingInput = Omit<Finding, "fingerprint"> & {
  readonly fingerprint?: string | undefined;
};

export interface RuleMetadata {
  readonly id: string;
  readonly category: RuleCategory;
  readonly defaultSeverity: Severity;
  readonly defaultConfidence: Confidence;
  readonly description: string;
  readonly requiresTypeInformation: boolean;
  readonly framework?: string | undefined;
}

export interface RepositorySummary {
  readonly typescriptVersion?: string | undefined;
  readonly reactVersion?: string | undefined;
  readonly packageManager: string;
  readonly projectCount: number;
  readonly workspaceType?: string | undefined;
}

export interface AuditSummary {
  readonly errors: number;
  readonly warnings: number;
  readonly info: number;
  readonly highConfidence: number;
  readonly mediumConfidence: number;
  readonly lowConfidence: number;
  readonly filesAnalyzed: number;
  readonly projectsCount: number;
}

export interface AuditResult {
  readonly findings: readonly Finding[];
  readonly summary: AuditSummary;
  readonly repository: RepositorySummary;
  readonly skippedSemanticRules?: readonly string[] | undefined;
}

export interface PackageJsonData {
  readonly name?: string | undefined;
  readonly version?: string | undefined;
  readonly private?: boolean | undefined;
  readonly workspaces?: readonly string[] | { readonly packages?: readonly string[] | undefined } | undefined;
  readonly dependencies?: Record<string, string> | undefined;
  readonly devDependencies?: Record<string, string> | undefined;
  readonly peerDependencies?: Record<string, string> | undefined;
}

export interface WorkspacePackage {
  readonly name: string;
  readonly packageDir: string;
  readonly relativePath: string;
  readonly packageJson: PackageJsonData;
  readonly isRoot: boolean;
}

export interface FrameworkInfo {
  readonly name: string;
  readonly version?: string | undefined;
}

export interface RepositoryContext {
  readonly rootDir: string;
  readonly packageManager: "npm" | "pnpm" | "yarn" | "bun" | "unknown";
  readonly rootManifest?: PackageJsonData | undefined;
  readonly isMonorepo: boolean;
  readonly workspaceType?: "pnpm" | "npm" | "yarn" | "bun" | undefined;
  readonly packages: readonly WorkspacePackage[];
  readonly reactVersion?: string | undefined;
  readonly reactDomVersion?: string | undefined;
  readonly hasReactCompiler: boolean;
  readonly reactCompilerConfig?: Record<string, unknown> | undefined;
  readonly frameworks: readonly FrameworkInfo[];
}

export interface RuleContext {
  readonly ts?: typeof ts | undefined;
  readonly program?: ts.Program | undefined;
  readonly checker?: ts.TypeChecker | undefined;
  readonly sourceFile: ts.SourceFile;
  readonly repoContext: RepositoryContext;
  readonly projectRoot: string;
  readonly typeScriptAvailable: boolean;
  report(finding: FindingInput): void;
  visitNodes(visitor: (node: ts.Node) => void): void;
  findEnclosingScope(node: ts.Node): ts.Node | undefined;
  resolveSymbol(node: ts.Node): ts.Symbol | undefined;
}

export interface Rule {
  readonly meta: RuleMetadata;
  analyze(context: RuleContext): void | Promise<void>;
}
