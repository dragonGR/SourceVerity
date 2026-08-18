import path from "node:path";
import type * as tsType from "typescript";
import { loadRepositoryTypeScript } from "../../src/repository/tsLoader.js";
import { createRuleContext } from "../../src/engine/context.js";
import type { Finding, FindingInput, Rule, RepositoryContext } from "../../src/core/types.js";

const tsInst = loadRepositoryTypeScript(process.cwd());

export interface TestRuleResult {
  readonly findings: readonly Finding[];
}

/**
 * Runs a rule against an in-memory TypeScript source string with full TypeChecker access.
 */
export function runRuleOnCode(rule: Rule, sourceText: string, fileName = "test.tsx"): readonly Finding[] {
  if (!tsInst) {
    throw new Error("TypeScript is required to run rule tests");
  }

  const ts = tsInst.ts;
  const compilerOptions: tsType.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  };

  const defaultLibFileName = ts.getDefaultLibFilePath(compilerOptions);

  const files = new Map<string, string>();
  files.set(fileName, sourceText);

  const host: tsType.CompilerHost = {
    getSourceFile(name) {
      if (files.has(name)) {
        return ts.createSourceFile(name, files.get(name)!, ts.ScriptTarget.ES2022, true);
      }
      if (ts.sys.fileExists(name)) {
        const libText = ts.sys.readFile(name) ?? "";
        return ts.createSourceFile(name, libText, ts.ScriptTarget.ES2022, true);
      }
      return undefined;
    },
    getDefaultLibFileName: () => defaultLibFileName,
    writeFile: () => {},
    getCurrentDirectory: () => process.cwd(),
    getDirectories: () => [],
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (f) => files.has(f) || ts.sys.fileExists(f),
    readFile: (f) => files.get(f) ?? ts.sys.readFile(f),
  };

  const program = ts.createProgram({
    rootNames: [fileName],
    options: compilerOptions,
    host,
  });

  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(fileName);
  if (!sourceFile) {
    throw new Error(`Failed to create source file for ${fileName}`);
  }

  const findings: Finding[] = [];
  const repoContext: RepositoryContext = {
    rootDir: process.cwd(),
    packageManager: "pnpm",
    isMonorepo: false,
    packages: [],
    hasReactCompiler: false,
    frameworks: [],
  };

  const context = createRuleContext({
    ts: tsInst.ts,
    program,
    checker,
    sourceFile,
    repoContext,
    projectRoot: process.cwd(),
    reportFinding(input: FindingInput) {
      findings.push({
        ...input,
        fingerprint: input.fingerprint ?? "sv_test_fp",
      });
    },
  });

  rule.analyze(context);
  return findings;
}
