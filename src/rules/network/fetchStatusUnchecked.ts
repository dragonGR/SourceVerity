import type * as tsType from "typescript";
import { getNodeSourceRange, isDOMGlobal } from "../../engine/symbols.js";
import type { Rule, RuleContext } from "../../core/types.js";

export const fetchStatusUncheckedRule: Rule = {
  meta: {
    id: "network/fetch-status-unchecked",
    category: "network",
    defaultSeverity: "warning",
    defaultConfidence: "high",
    description: "Detects consumption of fetch() response bodies without checking response.ok or status.",
    requiresTypeInformation: true,
  },

  analyze(context: RuleContext): void {
    const { sourceFile, checker, ts } = context;
    if (!checker || !ts) return;

    context.visitNodes((node: tsType.Node) => {
      // Look for VariableDeclaration: const res = await fetch(...)
      if (!ts.isVariableDeclaration(node)) return;
      if (!ts.isIdentifier(node.name)) return;
      const resVarName = node.name.text;

      const init = node.initializer;
      if (!init) return;

      let callExpr: tsType.CallExpression | undefined;
      if (ts.isAwaitExpression(init) && ts.isCallExpression(init.expression)) {
        callExpr = init.expression;
      } else if (ts.isCallExpression(init)) {
        callExpr = init;
      }

      if (!callExpr) return;

      // Check if call target is global DOM fetch
      let isFetchCall = false;
      if (ts.isIdentifier(callExpr.expression) && callExpr.expression.text === "fetch") {
        if (isDOMGlobal(callExpr.expression, checker, "fetch")) {
          isFetchCall = true;
        }
      } else if (
        ts.isPropertyAccessExpression(callExpr.expression) &&
        callExpr.expression.name.text === "fetch" &&
        ts.isIdentifier(callExpr.expression.expression) &&
        (callExpr.expression.expression.text === "window" || callExpr.expression.expression.text === "globalThis")
      ) {
        isFetchCall = true;
      }

      if (!isFetchCall) return;

      // Find enclosing block or function
      const scope = context.findEnclosingScope(node);
      if (!scope) return;

      let hasStatusCheck = false;
      let bodyConsumptionNode: tsType.Node | undefined;

      // Walk scope to look for usages of resVarName
      function inspectScope(n: tsType.Node) {
        // Check for res.ok or res.status access
        if (ts && ts.isPropertyAccessExpression(n)) {
          if (ts.isIdentifier(n.expression) && n.expression.text === resVarName) {
            const prop = n.name.text;
            if (prop === "ok" || prop === "status" || prop === "statusText") {
              hasStatusCheck = true;
            }
            if (prop === "json" || prop === "text" || prop === "blob" || prop === "arrayBuffer" || prop === "formData") {
              bodyConsumptionNode = n;
            }
          }
        }
        n.forEachChild(inspectScope);
      }

      inspectScope(scope);

      // If body was consumed but status was never checked in scope
      if (bodyConsumptionNode && !hasStatusCheck) {
        const range = getNodeSourceRange(bodyConsumptionNode, sourceFile);
        context.report({
          ruleId: "network/fetch-status-unchecked",
          category: "network",
          severity: "warning",
          confidence: "high",
          message: `Response body consumed via .${(bodyConsumptionNode as tsType.PropertyAccessExpression).name.text}() without checking response.ok or response.status.`,
          file: sourceFile.fileName,
          range,
          evidence: [
            {
              message: "fetch() does not reject on HTTP 4xx or 5xx status codes.",
              range,
            },
          ],
          suggestedAction: "Check `if (response.ok)` or verify `response.status` before consuming the response body.",
          safeAutomaticFix: false,
        });
      }
    });
  },
};
