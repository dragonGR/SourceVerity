import type * as tsType from "typescript";
import { getNodeSourceRange, resolveReactHook } from "../../engine/symbols.js";
import type { Rule, RuleContext } from "../../core/types.js";

export const timerCleanupRule: Rule = {
  meta: {
    id: "browser/timer-cleanup",
    category: "browser",
    defaultSeverity: "error",
    defaultConfidence: "high",
    description: "Detects timers registered in lifecycle hooks without corresponding cleanup.",
    requiresTypeInformation: false,
  },

  analyze(context: RuleContext): void {
    const { sourceFile, checker, ts } = context;
    if (!ts) return;

    context.visitNodes((node: tsType.Node) => {
      if (!ts.isCallExpression(node)) return;

      let isLifecycleHook = false;
      if (checker && (resolveReactHook(node, checker, "useEffect") || resolveReactHook(node, checker, "useLayoutEffect"))) {
        isLifecycleHook = true;
      } else if (ts.isIdentifier(node.expression) && (node.expression.text === "useEffect" || node.expression.text === "useLayoutEffect")) {
        isLifecycleHook = true;
      }

      if (!isLifecycleHook) return;

      const effectCallback = node.arguments[0];
      if (!effectCallback || (!ts.isArrowFunction(effectCallback) && !ts.isFunctionExpression(effectCallback))) {
        return;
      }

      const timers: Array<{
        node: tsType.CallExpression;
        timerKind: "setInterval" | "setTimeout";
        varName?: string | undefined;
      }> = [];

      const cleanups = new Set<string>();
      let hasCleanupReturn = false;

      function inspectEffectBody(n: tsType.Node) {
        // Look for: const id = setInterval(...) or setInterval(...)
        if (ts && ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
          const fnName = n.expression.text;
          if (fnName === "setInterval" || fnName === "setTimeout") {
            let varName: string | undefined;
            if (n.parent && ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name)) {
              varName = n.parent.name.text;
            }
            timers.push({
              node: n,
              timerKind: fnName,
              varName,
            });
          }
        }

        // Check for return statement
        if (ts && ts.isReturnStatement(n) && n.expression) {
          const retExpr = n.expression;
          if (ts.isArrowFunction(retExpr) || ts.isFunctionExpression(retExpr)) {
            hasCleanupReturn = true;
            inspectCleanupBody(retExpr);
          }
        }

        if (ts && n !== effectCallback && (ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n))) {
          return;
        }

        n.forEachChild(inspectEffectBody);
      }

      function inspectCleanupBody(cleanupFn: tsType.Node) {
        function walkCleanup(cn: tsType.Node) {
          if (ts && ts.isCallExpression(cn) && ts.isIdentifier(cn.expression)) {
            const fnName = cn.expression.text;
            if (fnName === "clearInterval" || fnName === "clearTimeout") {
              cleanups.add(fnName);
              const arg = cn.arguments[0];
              if (arg && ts.isIdentifier(arg)) {
                cleanups.add(arg.text);
              }
            }
          }
          cn.forEachChild(walkCleanup);
        }
        cleanupFn.forEachChild(walkCleanup);
      }

      inspectEffectBody(effectCallback.body);

      for (const timer of timers) {
        let isCleaned = false;
        if (hasCleanupReturn) {
          const expectedClear = timer.timerKind === "setInterval" ? "clearInterval" : "clearTimeout";
          if (cleanups.has(expectedClear)) {
            if (!timer.varName || cleanups.has(timer.varName)) {
              isCleaned = true;
            }
          }
        }

        if (!isCleaned) {
          const range = getNodeSourceRange(timer.node, sourceFile);
          const isInterval = timer.timerKind === "setInterval";

          context.report({
            ruleId: "browser/timer-cleanup",
            category: "browser",
            severity: isInterval ? "error" : "warning",
            confidence: isInterval ? "high" : "medium",
            message: `${timer.timerKind} registered in lifecycle hook is missing matching ${isInterval ? "clearInterval" : "clearTimeout"} cleanup.`,
            file: sourceFile.fileName,
            range,
            evidence: [
              {
                message: `Active ${timer.timerKind} timers that outlive the component lifecycle cause state leaks and background CPU consumption.`,
                range,
              },
            ],
            suggestedAction: `Clear the timer in the returned cleanup function: return () => ${isInterval ? "clearInterval" : "clearTimeout"}(id);`,
            safeAutomaticFix: false,
          });
        }
      }
    });
  },
};
