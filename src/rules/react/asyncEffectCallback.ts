import type * as tsType from "typescript";
import { getNodeSourceRange, isReactLifecycleHookCall } from "../../engine/symbols.js";
import type { Rule, RuleContext } from "../../core/types.js";

export const asyncEffectCallbackRule: Rule = {
  meta: {
    id: "react/async-effect-callback",
    category: "react",
    defaultSeverity: "error",
    defaultConfidence: "high",
    description: "Detects async functions passed directly as React useEffect callbacks.",
    requiresTypeInformation: false,
  },

  analyze(context: RuleContext): void {
    const { sourceFile, checker, ts } = context;
    if (!ts) return;

    context.visitNodes((node: tsType.Node) => {
      if (!ts.isCallExpression(node)) return;

      if (!isReactLifecycleHookCall(node, ts, checker)) return;

      const args = node.arguments;
      if (!args || args.length === 0) return;

      const callback = args[0];
      if (!callback) return;
      let isAsync = false;

      if (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) {
        if (callback.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) {
          isAsync = true;
        }
      }

      if (isAsync) {
        const range = getNodeSourceRange(callback, sourceFile);
        context.report({
          ruleId: "react/async-effect-callback",
          category: "react",
          severity: "error",
          confidence: "high",
          message: "Effect setup callback must not be an async function.",
          file: sourceFile.fileName,
          range,
          evidence: [
            {
              message: "React expects useEffect setup functions to return undefined or a synchronous cleanup function; async functions return a Promise.",
              range,
            },
          ],
          suggestedAction:
            "Define an async function inside the effect and call it synchronously: useEffect(() => { async function load() { ... } load(); }, []).",
          safeAutomaticFix: false,
        });
      }
    });
  },
};
