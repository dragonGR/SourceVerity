import type * as tsType from "typescript";
import { getNodeSourceRange, resolveReactHook } from "../../engine/symbols.js";
import type { Rule, RuleContext } from "../../core/types.js";

export const missingEffectCleanupRule: Rule = {
  meta: {
    id: "react/missing-effect-cleanup",
    category: "react",
    defaultSeverity: "warning",
    defaultConfidence: "high",
    description: "Detects external subscriptions created in useEffect without returned cleanup.",
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

      const subscriptions: Array<{ node: tsType.Node; name: string }> = [];
      let hasCleanupReturn = false;

      function inspectEffectBody(n: tsType.Node) {
        // Look for: new WebSocket(...), new EventSource(...), new BroadcastChannel(...)
        if (ts && ts.isNewExpression(n) && ts.isIdentifier(n.expression)) {
          const className = n.expression.text;
          if (className === "WebSocket" || className === "EventSource" || className === "BroadcastChannel") {
            subscriptions.push({ node: n, name: className });
          }
        }

        // Look for: client.subscribe(...)
        if (
          ts &&
          ts.isCallExpression(n) &&
          ts.isPropertyAccessExpression(n.expression) &&
          n.expression.name.text === "subscribe"
        ) {
          subscriptions.push({ node: n, name: ".subscribe()" });
        }

        // Check for return statement
        if (ts && ts.isReturnStatement(n) && n.expression) {
          hasCleanupReturn = true;
        }

        if (ts && n !== callback && (ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n))) {
          return;
        }

        n.forEachChild(inspectEffectBody);
      }

      inspectEffectBody(callback.body);

      if (subscriptions.length > 0 && !hasCleanupReturn) {
        for (const sub of subscriptions) {
          const range = getNodeSourceRange(sub.node, sourceFile);
          context.report({
            ruleId: "react/missing-effect-cleanup",
            category: "react",
            severity: "warning",
            confidence: "high",
            message: `Subscription resource '${sub.name}' created in useEffect without returning a cleanup function.`,
            file: sourceFile.fileName,
            range,
            evidence: [
              {
                message: "Unsubscribed listeners or open socket connections persist when the component unmounts.",
                range,
              },
            ],
            suggestedAction: "Return a cleanup function from useEffect that closes or unsubscribes the resource.",
            safeAutomaticFix: false,
          });
        }
      }
    });
  },
};
