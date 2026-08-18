import type * as tsType from "typescript";
import { getNodeSourceRange, isPromiseLike } from "../../engine/symbols.js";
import type { Rule, RuleContext } from "../../core/types.js";

/**
 * Determines whether an expression statement explicitly consumes a Promise result
 * using language/control-flow operators (e.g. `await` or `void`).
 */
function isExplicitlyConsumedExpression(expr: tsType.Expression, ts: typeof tsType): boolean {
  let current = expr;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }

  // 1. Explicit void operator for intentional fire-and-forget (e.g. void promise.catch(h))
  if (ts.isVoidExpression(current)) {
    return true;
  }

  // 2. Explicit await operator (e.g. await promise)
  if (ts.isAwaitExpression(current)) {
    return true;
  }

  return false;
}

export const floatingPromiseRule: Rule = {
  meta: {
    id: "async/floating-promise",
    category: "async",
    defaultSeverity: "error",
    defaultConfidence: "high",
    description: "Detects unhandled Promise returned in an expression statement position.",
    requiresTypeInformation: true,
  },

  analyze(context: RuleContext): void {
    const { sourceFile, checker, ts } = context;
    if (!checker || !ts) return;

    context.visitNodes((node: tsType.Node) => {
      // ExpressionStatement
      if (!ts.isExpressionStatement(node)) return;
      const expr = node.expression;

      // Check if the resulting Promise is explicitly consumed by language syntax (void / await)
      if (isExplicitlyConsumedExpression(expr, ts)) {
        return;
      }
      try {
        const type = checker.getTypeAtLocation(expr);
        if (isPromiseLike(type, checker)) {
          const range = getNodeSourceRange(expr, sourceFile);
          context.report({
            ruleId: "async/floating-promise",
            category: "async",
            severity: "error",
            confidence: "high",
            message: "Promise returned in expression statement is floating and unhandled.",
            file: sourceFile.fileName,
            range,
            evidence: [
              {
                message: "Floating promises can cause unhandled rejections and race conditions.",
                range,
              },
            ],
            suggestedAction:
              "Await the promise, prefix with `void` for intentional fire-and-forget, or chain a `.catch()` handler.",
            safeAutomaticFix: false,
          });
        }
      } catch {
        // Fall through
      }
    });
  },
};
