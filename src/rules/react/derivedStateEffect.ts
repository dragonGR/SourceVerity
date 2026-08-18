import type * as tsType from "typescript";
import { getNodeSourceRange, resolveReactHook } from "../../engine/symbols.js";
import type { Rule, RuleContext } from "../../core/types.js";

export const derivedStateEffectRule: Rule = {
  meta: {
    id: "react/derived-state-effect",
    category: "react",
    defaultSeverity: "warning",
    defaultConfidence: "high",
    description: "Detects Effects used exclusively to derive state from render inputs.",
    requiresTypeInformation: false,
  },

  analyze(context: RuleContext): void {
    const { sourceFile, checker, ts } = context;
    if (!ts) return;

    context.visitNodes((node: tsType.Node) => {
      if (!ts.isCallExpression(node)) return;

      let isEffectHook = false;
      if (checker && (resolveReactHook(node, checker, "useEffect") || resolveReactHook(node, checker, "useLayoutEffect"))) {
        isEffectHook = true;
      } else if (ts.isIdentifier(node.expression) && (node.expression.text === "useEffect" || node.expression.text === "useLayoutEffect")) {
        isEffectHook = true;
      }

      if (!isEffectHook) return;

      const args = node.arguments;
      if (!args || args.length === 0) return;

      const callback = args[0];
      if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) {
        return;
      }

      // Inspect statements in effect body
      const body = callback.body;
      let isOnlyStateSetter = false;
      let setterName = "";

      if (ts.isBlock(body)) {
        const stmts = body.statements;
        if (stmts.length === 1 && stmts[0] && ts.isExpressionStatement(stmts[0])) {
          const expr = stmts[0].expression;
          if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
            const fnName = expr.expression.text;
            if (/^set[A-Z]/.test(fnName)) {
              isOnlyStateSetter = true;
              setterName = fnName;
            }
          }
        }
      } else if (ts.isCallExpression(body) && ts.isIdentifier(body.expression)) {
        // Concise body: useEffect(() => setFullName(...), [dep])
        const fnName = body.expression.text;
        if (/^set[A-Z]/.test(fnName)) {
          isOnlyStateSetter = true;
          setterName = fnName;
        }
      }

      if (isOnlyStateSetter) {
        const range = getNodeSourceRange(node, sourceFile);
        context.report({
          ruleId: "react/derived-state-effect",
          category: "react",
          severity: "warning",
          confidence: "high",
          message: `State setter '${setterName}' is called unconditionally inside useEffect to derive state.`,
          file: sourceFile.fileName,
          range,
          evidence: [
            {
              message: "Synchronizing derived state in useEffect causes an extra render cycle and potential UI flicker.",
              range,
            },
          ],
          suggestedAction:
            "Compute the derived value directly during render instead of storing it in useState and syncing with useEffect.",
          safeAutomaticFix: false,
        });
      }
    });
  },
};
