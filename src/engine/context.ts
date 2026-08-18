import type * as tsType from "typescript";
import type { FindingInput, RepositoryContext, RuleContext } from "../core/types.js";

export interface CreateRuleContextOptions {
  readonly ts?: typeof tsType | undefined;
  readonly program?: tsType.Program | undefined;
  readonly checker?: tsType.TypeChecker | undefined;
  readonly sourceFile: tsType.SourceFile;
  readonly repoContext: RepositoryContext;
  readonly projectRoot: string;
  readonly reportFinding: (finding: FindingInput) => void;
}

/**
 * Creates an execution context for a single SourceFile during rule analysis.
 */
export function createRuleContext(options: CreateRuleContextOptions): RuleContext {
  const { ts, program, checker, sourceFile, repoContext, projectRoot, reportFinding } = options;

  return {
    ts,
    program,
    checker,
    sourceFile,
    repoContext,
    projectRoot,
    typeScriptAvailable: Boolean(program && checker),

    report(finding: FindingInput): void {
      reportFinding(finding);
    },

    visitNodes(visitor: (node: tsType.Node) => void): void {
      function walk(node: tsType.Node | undefined) {
        if (!node) return;
        visitor(node);
        node.forEachChild(walk);
      }
      walk(sourceFile);
    },

    findEnclosingScope(node: tsType.Node): tsType.Node | undefined {
      let current: tsType.Node | undefined = node.parent;
      while (current) {
        if (ts) {
          if (
            ts.isFunctionDeclaration(current) ||
            ts.isArrowFunction(current) ||
            ts.isFunctionExpression(current) ||
            ts.isMethodDeclaration(current) ||
            ts.isClassDeclaration(current) ||
            ts.isSourceFile(current)
          ) {
            return current;
          }
        } else {
          // Fallback to numeric SyntaxKind
          const k = current.kind;
          if (k === 262 || k === 219 || k === 218 || k === 173 || k === 263 || k === 312) {
            return current;
          }
        }
        current = current.parent;
      }
      return undefined;
    },

    resolveSymbol(node: tsType.Node): tsType.Symbol | undefined {
      if (!checker) return undefined;
      return checker.getSymbolAtLocation(node);
    },
  };
}
