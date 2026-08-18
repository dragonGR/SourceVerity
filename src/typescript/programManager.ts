import path from "node:path";
import type * as tsType from "typescript";
import type { TsProjectConfig } from "./projectResolver.js";
import type { TypeScriptInstance } from "../repository/tsLoader.js";

export interface ProjectProgram {
  readonly config: TsProjectConfig;
  readonly program: tsType.Program;
  readonly checker: tsType.TypeChecker;
  readonly sourceFiles: readonly tsType.SourceFile[];
  readonly projectRoot: string;
}

/**
 * Constructs an initialized TypeScript Program and TypeChecker for each project.
 *
 * Excludes external library declaration files (.d.ts) from the active
 * source file audit list, while retaining them in the Program for full semantic resolution.
 */
export function createProjectPrograms(
  projects: readonly TsProjectConfig[],
  tsInst: TypeScriptInstance,
  fileFilter?: (filePath: string) => boolean
): readonly ProjectProgram[] {
  const ts = tsInst.ts;
  const result: ProjectProgram[] = [];

  for (const proj of projects) {
    // If project has no root files, skip compilation
    if (proj.fileNames.length === 0) {
      continue;
    }

    const host = ts.createCompilerHost(proj.rawCompilerOptions, true);
    const program = ts.createProgram({
      rootNames: proj.fileNames,
      options: proj.rawCompilerOptions,
      host,
    });

    const checker = program.getTypeChecker();
    const allSourceFiles = program.getSourceFiles();

    const activeFiles: tsType.SourceFile[] = [];
    for (const sf of allSourceFiles) {
      // Exclude ambient declaration files (.d.ts) and node_modules from direct rule scanning
      if (sf.isDeclarationFile) {
        continue;
      }

      const filePath = sf.fileName;
      // Filter out files outside the project or excluded by .gitignore
      if (fileFilter && !fileFilter(filePath)) {
        continue;
      }

      activeFiles.push(sf);
    }

    result.push({
      config: proj,
      program,
      checker,
      sourceFiles: activeFiles,
      projectRoot: proj.projectDir,
    });
  }

  return result;
}
