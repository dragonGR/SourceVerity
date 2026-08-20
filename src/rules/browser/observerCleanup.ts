import type * as tsType from "typescript";
import { getNodeSourceRange, isReactLifecycleHookCall, isDOMGlobal } from "../../engine/symbols.js";
import type { Rule, RuleContext } from "../../core/types.js";

const DOM_OBSERVER_NAMES = new Set(["ResizeObserver", "IntersectionObserver", "MutationObserver"]);

function isDOMObserverClass(node: tsType.Node, checker: tsType.TypeChecker | undefined, ts: typeof tsType): string | null {
  if (ts.isIdentifier(node)) {
    const name = node.text;
    if (DOM_OBSERVER_NAMES.has(name)) {
      if (checker) {
        return isDOMGlobal(node, checker, name) ? name : null;
      }
      return name;
    }
  }

  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    (node.expression.text === "window" || node.expression.text === "globalThis")
  ) {
    const name = node.name.text;
    if (DOM_OBSERVER_NAMES.has(name)) {
      return name;
    }
  }

  return null;
}

export const observerCleanupRule: Rule = {
  meta: {
    id: "browser/observer-cleanup",
    category: "browser",
    defaultSeverity: "error",
    defaultConfidence: "high",
    description: "Detects DOM Observers instantiated in lifecycle hooks without .disconnect() cleanup.",
    requiresTypeInformation: false,
  },

  analyze(context: RuleContext): void {
    const { sourceFile, checker, ts } = context;
    if (!ts) return;

    context.visitNodes((node: tsType.Node) => {
      if (!ts.isCallExpression(node)) return;

      if (!isReactLifecycleHookCall(node, ts, checker)) return;

      const effectCallback = node.arguments[0];
      if (!effectCallback || (!ts.isArrowFunction(effectCallback) && !ts.isFunctionExpression(effectCallback))) {
        return;
      }

      interface ObserverInstance {
        readonly node: tsType.NewExpression;
        readonly observerName: string;
        readonly varName?: string | undefined;
        readonly symbol?: tsType.Symbol | undefined;
      }

      const observers: ObserverInstance[] = [];
      const disconnectedSymbols = new Set<tsType.Symbol>();
      const disconnectedNames = new Set<string>();
      let hasCleanupReturn = false;

      function inspectEffectBody(n: tsType.Node) {
        if (ts && ts.isNewExpression(n)) {
          const className = isDOMObserverClass(n.expression, checker, ts);
          if (className) {
            let varName: string | undefined;
            let symbol: tsType.Symbol | undefined;

            const parent = n.parent;
            if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
              varName = parent.name.text;
              if (checker) {
                symbol = checker.getSymbolAtLocation(parent.name);
              }
            } else if (
              parent &&
              ts.isBinaryExpression(parent) &&
              parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
              ts.isIdentifier(parent.left)
            ) {
              varName = parent.left.text;
              if (checker) {
                symbol = checker.getSymbolAtLocation(parent.left);
              }
            }

            observers.push({
              node: n,
              observerName: className,
              varName,
              symbol,
            });
          }
        }

        // Check for cleanup return
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
          if (
            ts &&
            ts.isCallExpression(cn) &&
            ts.isPropertyAccessExpression(cn.expression) &&
            cn.expression.name.text === "disconnect"
          ) {
            const receiver = cn.expression.expression;
            if (ts.isIdentifier(receiver)) {
              disconnectedNames.add(receiver.text);
              if (checker) {
                const sym = checker.getSymbolAtLocation(receiver);
                if (sym) {
                  disconnectedSymbols.add(sym);
                  // Resolve local variable aliases (e.g. const cleanupRef = ro)
                  let currentDecl: tsType.Declaration | undefined = sym.valueDeclaration;
                  while (
                    currentDecl &&
                    ts.isVariableDeclaration(currentDecl) &&
                    currentDecl.initializer &&
                    ts.isIdentifier(currentDecl.initializer)
                  ) {
                    disconnectedNames.add(currentDecl.initializer.text);
                    const originSym = checker.getSymbolAtLocation(currentDecl.initializer);
                    if (originSym) {
                      disconnectedSymbols.add(originSym);
                      currentDecl = originSym.valueDeclaration;
                    } else {
                      break;
                    }
                  }
                  try {
                    const aliased = checker.getAliasedSymbol(sym);
                    if (aliased) disconnectedSymbols.add(aliased);
                  } catch {
                    // Not an aliased symbol
                  }
                }
              }
            }
          }
          cn.forEachChild(walkCleanup);
        }
        cleanupFn.forEachChild(walkCleanup);
      }

      inspectEffectBody(effectCallback.body);

      for (const obs of observers) {
        let isDisconnected = false;

        if (hasCleanupReturn) {
          if (obs.symbol && disconnectedSymbols.has(obs.symbol)) {
            isDisconnected = true;
          } else if (obs.varName && disconnectedNames.has(obs.varName)) {
            isDisconnected = true;
          }
        }

        if (!isDisconnected) {
          const range = getNodeSourceRange(obs.node, sourceFile);
          const detailMsg = !obs.varName
            ? `Anonymous ${obs.observerName} instance cannot be disconnected in cleanup.`
            : hasCleanupReturn
            ? `${obs.observerName} instance '${obs.varName}' is missing matching '${obs.varName}.disconnect()' in cleanup return.`
            : "No cleanup function was returned from the lifecycle hook.";

          context.report({
            ruleId: "browser/observer-cleanup",
            category: "browser",
            severity: "error",
            confidence: "high",
            message: `${obs.observerName} instantiated in lifecycle hook without calling .disconnect() in cleanup.`,
            file: sourceFile.fileName,
            range,
            evidence: [
              {
                message: detailMsg,
                range,
              },
            ],
            suggestedAction: `Disconnect the observer in the returned cleanup function: return () => ${obs.varName ?? "observer"}.disconnect();`,
            safeAutomaticFix: false,
          });
        }
      }
    });
  },
};
