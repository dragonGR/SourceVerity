import type * as tsType from "typescript";
import { getNodeSourceRange, isReactLifecycleHookCall } from "../../engine/symbols.js";
import type { Rule, RuleContext } from "../../core/types.js";

function unwrapParentheses(expr: tsType.Expression, ts: typeof tsType): tsType.Expression {
  let cur = expr;
  while (ts.isParenthesizedExpression(cur)) {
    cur = cur.expression;
  }
  return cur;
}

/**
 * Determines whether a returned expression is a valid, callable cleanup callback.
 * Arbitrary primitives, objects, or non-callable values do not satisfy cleanup.
 */
function isCallableCleanupExpression(
  rawExpr: tsType.Expression,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined,
  scopeNode?: tsType.Node | undefined
): boolean {
  const expr = unwrapParentheses(rawExpr, ts);

  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
    return true;
  }

  if (ts.isConditionalExpression(expr)) {
    return (
      isCallableCleanupExpression(expr.whenTrue, ts, checker, scopeNode) ||
      isCallableCleanupExpression(expr.whenFalse, ts, checker, scopeNode)
    );
  }

  if (checker) {
    const type = checker.getTypeAtLocation(expr);
    if (type) {
      if (type.getCallSignatures().length > 0) {
        return true;
      }
      if (type.isUnion() && type.types.some((t) => t.getCallSignatures().length > 0)) {
        return true;
      }
    }

    const symbol = checker.getSymbolAtLocation(expr);
    if (symbol) {
      let resolvedSym = symbol;
      if ((resolvedSym.flags & ts.SymbolFlags.Alias) !== 0) {
        try {
          resolvedSym = checker.getAliasedSymbol(resolvedSym);
        } catch {
          // ignore
        }
      }
      const decls = resolvedSym.getDeclarations();
      if (decls) {
        for (const decl of decls) {
          if (ts.isFunctionDeclaration(decl) || ts.isFunctionExpression(decl) || ts.isArrowFunction(decl)) {
            return true;
          }
          if (ts.isVariableDeclaration(decl) && decl.initializer) {
            const init = unwrapParentheses(decl.initializer, ts);
            if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
              return true;
            }
            const initType = checker.getTypeAtLocation(init);
            if (initType && initType.getCallSignatures().length > 0) {
              return true;
            }
          }
        }
      }
    }
  }

  // AST-based fallback within the effect scope when checker is unavailable or symbol is local
  if (ts.isIdentifier(expr) && scopeNode) {
    const targetName = expr.text;
    let foundCallable = false;

    function checkScope(node: tsType.Node) {
      if (foundCallable) return;
      if (ts.isFunctionDeclaration(node) && node.name && node.name.text === targetName) {
        foundCallable = true;
        return;
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === targetName &&
        node.initializer
      ) {
        const init = unwrapParentheses(node.initializer, ts);
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          foundCallable = true;
          return;
        }
      }
      node.forEachChild(checkScope);
    }

    checkScope(scopeNode);
    if (foundCallable) return true;
  }

  return false;
}

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

      if (!isReactLifecycleHookCall(node, ts, checker)) return;

      const args = node.arguments;
      if (!args || args.length === 0) return;

      const callback = args[0];
      if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) {
        return;
      }

      const callbackBody = callback.body;
      const subscriptions: Array<{ node: tsType.Node; name: string }> = [];
      let hasCleanupReturn = false;

      // Check concise arrow body: useEffect(() => () => socket.close(), [])
      if (!ts.isBlock(callbackBody)) {
        if (isCallableCleanupExpression(callbackBody, ts, checker, callbackBody)) {
          hasCleanupReturn = true;
        }
      }

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
          if (isCallableCleanupExpression(n.expression, ts, checker, callbackBody)) {
            hasCleanupReturn = true;
          }
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
