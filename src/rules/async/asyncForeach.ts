import type * as tsType from "typescript";
import { getNodeSourceRange, isPromiseLike } from "../../engine/symbols.js";
import type { Rule, RuleContext } from "../../core/types.js";

export const asyncForeachRule: Rule = {
  meta: {
    id: "async/async-foreach",
    category: "async",
    defaultSeverity: "error",
    defaultConfidence: "high",
    description: "Detects asynchronous callbacks passed to Array.prototype.forEach.",
    requiresTypeInformation: false,
  },

  analyze(context: RuleContext): void {
    const { sourceFile, checker, ts } = context;
    if (!ts) return;

    context.visitNodes((node: tsType.Node) => {
      if (!ts.isCallExpression(node)) return;
      const expr = node.expression;
      if (!ts.isPropertyAccessExpression(expr)) return;
      if (expr.name.text !== "forEach") return;

      const args = node.arguments;
      if (!args || args.length === 0) return;

      const callbackArg = args[0];
      if (!callbackArg) return;

      // 1. Direct async arrow function or function expression
      let isAsync = false;
      if (ts.isArrowFunction(callbackArg) || ts.isFunctionExpression(callbackArg)) {
        if (callbackArg.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) {
          isAsync = true;
        }
      }

      // 2. Semantic check if callback type returns a Promise
      if (!isAsync && checker) {
        try {
          const type = checker.getTypeAtLocation(callbackArg);
          const callSignatures = type.getCallSignatures();
          for (const sig of callSignatures) {
            const retType = sig.getReturnType();
            if (isPromiseLike(retType, checker)) {
              isAsync = true;
              break;
            }
          }
        } catch {
          // Fall back to syntactic check
        }
      }

      if (isAsync) {
        const range = getNodeSourceRange(node, sourceFile);
        context.report({
          ruleId: "async/async-foreach",
          category: "async",
          severity: "error",
          confidence: "high",
          message: "Asynchronous callback passed to forEach will not be awaited.",
          file: sourceFile.fileName,
          range,
          evidence: [
            {
              message: "Array.prototype.forEach does not await returned Promises from its callback.",
              range,
            },
          ],
          suggestedAction:
            "Use for...of with await for sequential execution, or Promise.all(items.map(...)) for concurrent execution.",
          safeAutomaticFix: false,
        });
      }
    });
  },
};
