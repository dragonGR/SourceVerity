import type * as tsType from "typescript";
import { getNodeSourceRange, isFetchResponseMethod } from "../../engine/symbols.js";
import type { Rule, RuleContext } from "../../core/types.js";

function unwrapExpression(expr: tsType.Expression, ts: typeof tsType): tsType.Expression {
  let current = expr;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAwaitExpression(current) ||
    (ts.isAsExpression(current) &&
      (current.type.kind === ts.SyntaxKind.UnknownKeyword || current.type.kind === ts.SyntaxKind.AnyKeyword)) ||
    (ts.isTypeAssertionExpression(current) &&
      (current.type.kind === ts.SyntaxKind.UnknownKeyword || current.type.kind === ts.SyntaxKind.AnyKeyword))
  ) {
    current = current.expression;
  }
  return current;
}

export const unsafeUnvalidatedAssertionRule: Rule = {
  meta: {
    id: "typescript/unsafe-unvalidated-assertion",
    category: "typescript",
    defaultSeverity: "error",
    defaultConfidence: "high",
    description: "Detects runtime boundary data asserted directly to domain types without validation.",
    requiresTypeInformation: false,
  },

  analyze(context: RuleContext): void {
    const { sourceFile, checker, ts } = context;
    if (!ts) return;

    context.visitNodes((node: tsType.Node) => {
      let expr: tsType.Expression | undefined;
      let typeNode: tsType.TypeNode | undefined;

      if (ts.isAsExpression(node)) {
        expr = node.expression;
        typeNode = node.type;
      } else if (ts.isTypeAssertionExpression(node)) {
        expr = node.expression;
        typeNode = node.type;
      }

      if (!expr || !typeNode) return;

      // Check if target type is any, unknown, or primitive (safe boundary / widening)
      if (
        typeNode.kind === ts.SyntaxKind.AnyKeyword ||
        typeNode.kind === ts.SyntaxKind.UnknownKeyword ||
        typeNode.kind === ts.SyntaxKind.StringKeyword ||
        typeNode.kind === ts.SyntaxKind.NumberKeyword ||
        typeNode.kind === ts.SyntaxKind.BooleanKeyword
      ) {
        return;
      }

      // Check if the inner expression is a runtime boundary call
      let isRuntimeBoundary = false;
      let boundaryName = "";

      const targetExpr = unwrapExpression(expr, ts);

      if (ts.isCallExpression(targetExpr)) {
        const callTarget = targetExpr.expression;

        // 1. JSON.parse(...)
        if (ts.isPropertyAccessExpression(callTarget)) {
          if (
            ts.isIdentifier(callTarget.expression) &&
            callTarget.expression.text === "JSON" &&
            callTarget.name.text === "parse"
          ) {
            isRuntimeBoundary = true;
            boundaryName = "JSON.parse()";
          } else if (callTarget.name.text === "json" && isFetchResponseMethod(callTarget, checker, ts)) {
            // 2. response.json()
            isRuntimeBoundary = true;
            boundaryName = "response.json()";
          } else if (
            callTarget.name.text === "getItem" &&
            ts.isIdentifier(callTarget.expression) &&
            (callTarget.expression.text === "localStorage" || callTarget.expression.text === "sessionStorage")
          ) {
            // 3. localStorage.getItem(...)
            isRuntimeBoundary = true;
            boundaryName = `${callTarget.expression.text}.getItem()`;
          }
        }
      }

      if (isRuntimeBoundary) {
        let isInsideTryCatch = false;
        let curr: tsType.Node = node;
        while (curr.parent && !ts.isSourceFile(curr.parent)) {
          if (ts.isTryStatement(curr.parent) && curr.parent.tryBlock === curr) {
            if (curr.parent.catchClause) {
              isInsideTryCatch = true;
              break;
            }
          }
          curr = curr.parent;
        }

        const range = getNodeSourceRange(node, sourceFile);
        if (isInsideTryCatch) {
          context.report({
            ruleId: "typescript/unsafe-unvalidated-assertion",
            category: "typescript",
            severity: "warning",
            confidence: "medium",
            message: `Runtime boundary data from ${boundaryName} is asserted to type without runtime validation (exceptions caught by local try/catch).`,
            file: sourceFile.fileName,
            range,
            evidence: [
              {
                message:
                  "Type assertions bypass compiler checking. While the surrounding try/catch prevents uncaught runtime crashes, untyped runtime structures may silently degrade domain state.",
                range,
              },
            ],
            suggestedAction: "Validate payload with a runtime schema validator or type guard before asserting.",
            safeAutomaticFix: false,
          });
        } else {
          context.report({
            ruleId: "typescript/unsafe-unvalidated-assertion",
            category: "typescript",
            severity: "error",
            confidence: "high",
            message: `Runtime boundary data from ${boundaryName} is asserted to type without runtime validation.`,
            file: sourceFile.fileName,
            range,
            evidence: [
              {
                message:
                  "Type assertions bypass compiler checking without verifying that runtime structure satisfies the target type.",
                range,
              },
            ],
            suggestedAction: "Validate payload with a runtime schema validator before asserting or casting.",
            safeAutomaticFix: false,
          });
        }
      }
    });
  },
};
