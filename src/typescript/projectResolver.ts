import path from "node:path";
import type * as tsType from "typescript";
import type { RepositoryContext } from "../repository/types.js";
import type { TypeScriptInstance } from "../repository/tsLoader.js";

export interface TsProjectConfig {
  readonly configPath: string;
  readonly projectDir: string;
  readonly parsedCommandLine: tsType.ParsedCommandLine;
  readonly fileNames: readonly string[];
  readonly rawCompilerOptions: tsType.CompilerOptions;
  readonly references: readonly string[];
}

/**
 * Resolves and parses a tsconfig.json using the repository's TypeScript compiler API.
 */
function parseTsConfigFile(
  configPath: string,
  tsInst: TypeScriptInstance
): TsProjectConfig | null {
  const ts = tsInst.ts;
  const projectDir = path.dirname(path.resolve(configPath));

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    return null;
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    projectDir,
    undefined,
    configPath
  );

  const references: string[] = [];
  if (parsed.projectReferences) {
    for (const ref of parsed.projectReferences) {
      if (ref.path) {
        const resolvedRefPath = path.isAbsolute(ref.path)
          ? ref.path
          : path.resolve(projectDir, ref.path);
        references.push(resolvedRefPath);
      }
    }
  }

  return {
    configPath: path.resolve(configPath),
    projectDir,
    parsedCommandLine: parsed,
    fileNames: parsed.fileNames,
    rawCompilerOptions: parsed.options,
    references,
  };
}

/**
 * Discovers and parses all tsconfig projects across the repository root and packages.
 * Resolves project references and removes duplicates.
 */
export function resolveTsProjects(
  repo: RepositoryContext,
  tsInst: TypeScriptInstance
): readonly TsProjectConfig[] {
  const ts = tsInst.ts;
  const visitedConfigs = new Set<string>();
  const projects: TsProjectConfig[] = [];

  const candidateDirs: string[] = [repo.rootDir];
  for (const pkg of repo.packages) {
    candidateDirs.push(pkg.packageDir);
  }

  const exploreConfig = (configPath: string) => {
    const normalized = path.resolve(configPath);
    if (visitedConfigs.has(normalized)) {
      return;
    }
    visitedConfigs.add(normalized);

    const project = parseTsConfigFile(normalized, tsInst);
    if (!project) {
      return;
    }

    projects.push(project);

    // Recursively resolve project references
    for (const ref of project.references) {
      let refConfig = ref;
      if (ts.sys.directoryExists(ref)) {
        refConfig = path.join(ref, "tsconfig.json");
      }
      if (ts.sys.fileExists(refConfig)) {
        exploreConfig(refConfig);
      }
    }
  };

  for (const dir of candidateDirs) {
    const tsconfigPath = path.join(dir, "tsconfig.json");
    if (ts.sys.fileExists(tsconfigPath)) {
      exploreConfig(tsconfigPath);
    }
  }

  return projects;
}
