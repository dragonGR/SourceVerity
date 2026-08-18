export type PackageManagerType = "npm" | "pnpm" | "yarn" | "bun" | "unknown";

export interface PackageManifest {
  readonly name?: string | undefined;
  readonly version?: string | undefined;
  readonly private?: boolean | undefined;
  readonly type?: "module" | "commonjs" | undefined;
  readonly workspaces?: readonly string[] | { readonly packages?: readonly string[] | undefined } | undefined;
  readonly dependencies?: Record<string, string> | undefined;
  readonly devDependencies?: Record<string, string> | undefined;
  readonly peerDependencies?: Record<string, string> | undefined;
}

export interface DiscoveredPackage {
  readonly name: string;
  readonly packageDir: string;
  readonly relativePath: string;
  readonly packageJson: PackageManifest;
  readonly isRoot: boolean;
}

export interface FrameworkInfo {
  readonly name: string;
  readonly version?: string | undefined;
}

export interface RepositoryContext {
  readonly rootDir: string;
  readonly packageManager: PackageManagerType;
  readonly isMonorepo: boolean;
  readonly workspaceType?: "pnpm" | "npm" | "yarn" | "bun" | undefined;
  readonly rootManifest?: PackageManifest | undefined;
  readonly packages: readonly DiscoveredPackage[];
  readonly reactVersion?: string | undefined;
  readonly reactDomVersion?: string | undefined;
  readonly hasReactCompiler: boolean;
  readonly reactCompilerConfig?: Record<string, unknown> | undefined;
  readonly frameworks: readonly FrameworkInfo[];
}
