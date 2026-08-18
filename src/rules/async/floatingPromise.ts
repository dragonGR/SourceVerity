import type * as tsType from "typescript";
import { getNodeSourceRange, isPromiseLike } from "../../engine/symbols.js";
import type { Rule, RuleContext } from "../../core/types.js";

function isUndefinedOrNull(node: tsType.Node, ts: typeof tsType): boolean {
  if (ts.isIdentifier(node) && node.text === "undefined") {
    return true;
  }
  if (node.kind === ts.SyntaxKind.NullKeyword || node.kind === ts.SyntaxKind.UndefinedKeyword) {
    return true;
  }
  return false;
}

/**
 * Determines whether a Promise expression chain ends with a terminal rejection handler
 * (e.g. `.catch(onRejected)` or `.then(onFulfilled, onRejected)`).
 */
function hasTerminalRejectionHandler(expr: tsType.Expression, ts: typeof tsType): boolean {
  let current = expr;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }

  if (!ts.isCallExpression(current)) {
    return false;
  }

  const callee = current.expression;
  if (!ts.isPropertyAccessExpression(callee)) {
    return false;
  }

  const methodName = callee.name.text;

  // 1. Terminal .catch(onRejected)
  if (methodName === "catch") {
    const args = current.arguments;
    if (args.length >= 1 && args[0] && !isUndefinedOrNull(args[0], ts)) {
      return true;
    }
  }

  // 2. Terminal .then(onFulfilled, onRejected)
  if (methodName === "then") {
    const args = current.arguments;
    if (args.length >= 2 && args[1] && !isUndefinedOrNull(args[1], ts)) {
      return true;
    }
  }

  return false;
}

/**
 * Determines whether an expression statement explicitly consumes a Promise result
 * using language/control-flow operators (`await`, `void`) or a terminal rejection handler.
 */
function isExplicitlyConsumedExpression(expr: tsType.Expression, ts: typeof tsType): boolean {
  let current = expr;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }

  // 1. Explicit void operator for intentional fire-and-forget (e.g. void promise.then(h))
  if (ts.isVoidExpression(current)) {
    return true;
  }

  // 2. Explicit await operator (e.g. await promise)
  if (ts.isAwaitExpression(current)) {
    return true;
  }

  // 3. Terminal rejection handler (e.g. promise.catch(h), promise.then(onF, onR), promise.then(h).catch(h))
  if (hasTerminalRejectionHandler(current, ts)) {
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
              "Await the promise, prefix with `void` for intentional fire-and-forget, or chain a terminal `.catch()` handler.",
            safeAutomaticFix: false,
          });
        }
      } catch {
        // Fall through
      }
    });
  },
};
