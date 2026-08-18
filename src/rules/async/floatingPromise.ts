import type * as tsType from "typescript";
import { getNodeSourceRange } from "../../engine/symbols.js";
import { unwrapExpression } from "../../analysis/values.js";
import {
  classifyPromiseType,
  evaluatePromiseConsumption,
  isVariableTargetReturnedInScope,
} from "../../analysis/promiseFlow.js";
import type { Rule, RuleContext } from "../../core/types.js";

function canSyntacticallyBePromise(expr: tsType.Expression, ts: typeof tsType): boolean {
  const unwrapped = unwrapExpression(expr, ts);
  const k = unwrapped.kind;

  // Primitives and literals
  if (
    k === ts.SyntaxKind.StringLiteral ||
    k === ts.SyntaxKind.NumericLiteral ||
    k === ts.SyntaxKind.BigIntLiteral ||
    k === ts.SyntaxKind.TrueKeyword ||
    k === ts.SyntaxKind.FalseKeyword ||
    k === ts.SyntaxKind.NullKeyword ||
    k === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
    k === ts.SyntaxKind.RegularExpressionLiteral
  ) {
    return false;
  }

  // Function definitions (not function calls)
  if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) {
    return false;
  }

  // JSX elements and fragments
  if (
    ts.isJsxElement(unwrapped) ||
    ts.isJsxSelfClosingElement(unwrapped) ||
    ts.isJsxFragment(unwrapped)
  ) {
    return false;
  }

  // Unary expressions (!x, typeof x, +x, -x, ~x, void x, delete x)
  if (
    ts.isPrefixUnaryExpression(unwrapped) ||
    ts.isPostfixUnaryExpression(unwrapped) ||
    ts.isTypeOfExpression(unwrapped) ||
    ts.isDeleteExpression(unwrapped)
  ) {
    return false;
  }

  // Array literals ([1, 2, 3])
  if (ts.isArrayLiteralExpression(unwrapped)) {
    return false;
  }

  // Object literals without 'then' property
  if (ts.isObjectLiteralExpression(unwrapped)) {
    for (const prop of unwrapped.properties) {
      if (prop.name && "text" in prop.name && prop.name.text === "then") {
        return true;
      }
    }
    return false;
  }

  return true;
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
      // ── CASE 1: ExpressionStatement (e.g. doWork(); or p.then(); or cached = load();) ──
      if (ts.isExpressionStatement(node)) {
        const expr = node.expression;
        const unwrapped = unwrapExpression(expr, ts);

        // Fast path for explicit void operator or await expression
        if (ts.isVoidExpression(unwrapped) || ts.isAwaitExpression(unwrapped)) {
          return;
        }

        if (!canSyntacticallyBePromise(expr, ts)) {
          return;
        }
        try {
          const type = checker.getTypeAtLocation(expr);
          const classification = classifyPromiseType(type, checker, ts);

          if (!classification.isPromise) {
            return;
          }

          // Only evaluate deep consumption if expression is genuinely a Promise
          const consumption = evaluatePromiseConsumption(expr, ts, checker);
          if (consumption.isConsumed) {
            return;
          }

          const range = getNodeSourceRange(expr, sourceFile);

          // Optional union return types (e.g. `void | Promise<void>`) on arbitrary unmodeled functions
          // carry uncertainty and are reported with calibrated medium confidence rather than high confidence error.
          if (classification.isOptionalPromiseUnion) {
            context.report({
              ruleId: "async/floating-promise",
              category: "async",
              severity: "warning",
              confidence: "medium",
              message: "Expression returns an optional Promise (void | Promise<void>) that may be floating and unhandled.",
              file: sourceFile.fileName,
              range,
              evidence: [
                {
                  message: "Optional Promise union return types may produce unhandled rejections if the asynchronous branch executes without handling.",
                  range,
                },
              ],
              suggestedAction:
                "Await the call, handle potential rejections, or prefix with `void` if fire-and-forget is intended.",
              safeAutomaticFix: false,
            });
            return;
          }

          // Definite Promise return types (Promise<T>) in expression statements without handling
          if (classification.isDefinitePromise) {
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
          // Fall through on type resolution failure
        }
        return;
      }

      // ── CASE 2: VariableDeclaration with Promise initializer (e.g. let p = load();) ──
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
        const init = node.initializer;
        const unwrappedInit = unwrapExpression(init, ts);

        // Fast path for explicit await or void
        if (ts.isAwaitExpression(unwrappedInit) || ts.isVoidExpression(unwrappedInit)) {
          return;
        }

        if (!canSyntacticallyBePromise(init, ts)) {
          return;
        }
        try {
          const type = checker.getTypeAtLocation(init);
          const classification = classifyPromiseType(type, checker, ts);

          if (!classification.isDefinitePromise) {
            return;
          }

          // If initializer is explicitly catch-chained or safely consumed, skip
          const consumption = evaluatePromiseConsumption(init, ts, checker);
          if (consumption.isConsumed) {
            return;
          }

          if (ts.isIdentifier(node.name)) {
            const varName = node.name.text;
            const reachesReturn = isVariableTargetReturnedInScope(node, varName, ts);
            if (reachesReturn) {
              return;
            }

            const range = getNodeSourceRange(init, sourceFile);
            context.report({
              ruleId: "async/floating-promise",
              category: "async",
              severity: "error",
              confidence: "high",
              message: "Promise initialized in variable declaration is not returned or consumed, risking unhandled rejection.",
              file: sourceFile.fileName,
              range,
              evidence: [
                {
                  message: `Variable '${varName}' holds a Promise that is discarded or overwritten before reaching a return.`,
                  range,
                },
              ],
              suggestedAction:
                "Await the promise, return it from the function, or handle rejections with a terminal `.catch()` handler.",
              safeAutomaticFix: false,
            });
          }
        } catch {
          // Fall through
        }
      }
    });
  },
};
