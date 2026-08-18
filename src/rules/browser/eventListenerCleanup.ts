import type * as tsType from "typescript";
import { getNodeSourceRange, resolveReactHook, isDOMEventTarget, isDOMAbortController } from "../../engine/symbols.js";
import type { Rule, RuleContext } from "../../core/types.js";

export const eventListenerCleanupRule: Rule = {
  meta: {
    id: "browser/event-listener-cleanup",
    category: "browser",
    defaultSeverity: "error",
    defaultConfidence: "high",
    description: "Detects addEventListener registered in lifecycle hooks without matching removeEventListener cleanup.",
    requiresTypeInformation: false,
  },

  analyze(context: RuleContext): void {
    const { sourceFile, checker, ts } = context;
    if (!ts) return;

    context.visitNodes((node: tsType.Node) => {
      // Find useEffect or useLayoutEffect calls
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

      // Collect addEventListener calls inside the effect callback
      interface AddListenerInfo {
        readonly node: tsType.CallExpression;
        readonly eventType: string;
        readonly handlerName?: string | undefined;
        readonly isInlineHandler: boolean;
        readonly controllerName?: string | undefined;
        readonly controllerSymbol?: tsType.Symbol | undefined;
      }

      const addListeners: AddListenerInfo[] = [];

      // Collect removeEventListener calls inside cleanup returns
      const removeListeners: Array<{
        eventType: string;
        handlerName?: string | undefined;
        isInlineHandler: boolean;
      }> = [];

      const abortedControllerNames = new Set<string>();
      const abortedControllerSymbols = new Set<tsType.Symbol>();
      let hasCleanupReturn = false;

      function extractControllerNode(
        signalExpr: tsType.Expression,
        chk: tsType.TypeChecker | undefined,
        t: typeof tsType
      ): tsType.Node | undefined {
        if (t.isPropertyAccessExpression(signalExpr) && signalExpr.name.text === "signal") {
          const target = signalExpr.expression;
          if (isDOMAbortController(target, chk, t)) {
            return target;
          }
        }

        if (t.isIdentifier(signalExpr) && chk) {
          const sym = chk.getSymbolAtLocation(signalExpr);
          if (sym?.valueDeclaration && t.isVariableDeclaration(sym.valueDeclaration) && sym.valueDeclaration.initializer) {
            return extractControllerNode(sym.valueDeclaration.initializer, chk, t);
          }
        }

        return undefined;
      }

      function inspectEffectBody(n: tsType.Node) {
        // Look for target.addEventListener('event', handler, options)
        if (ts && ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "addEventListener") {
          const target = n.expression.expression;
          // Only audit authentic DOM EventTargets (window, document, HTMLElement, etc.)
          if (!isDOMEventTarget(target, checker, ts)) {
            return;
          }

          const args = n.arguments;
          const eventTypeArg = args[0];
          const handlerArg = args[1];
          if (eventTypeArg && handlerArg) {
            const eventType = ts.isStringLiteral(eventTypeArg) ? eventTypeArg.text : "";
            const isInline = ts.isArrowFunction(handlerArg) || ts.isFunctionExpression(handlerArg);
            const handlerName = ts.isIdentifier(handlerArg) ? handlerArg.text : undefined;

            let controllerName: string | undefined;
            let controllerSymbol: tsType.Symbol | undefined;

            // Check options argument (3rd arg) for { signal: controller.signal } or { signal }
            const optionsArg = args[2];
            if (optionsArg && ts.isObjectLiteralExpression(optionsArg)) {
              for (const prop of optionsArg.properties) {
                if (ts.isPropertyAssignment(prop) && prop.name && "text" in prop.name && prop.name.text === "signal") {
                  const ctrlNode = extractControllerNode(prop.initializer, checker, ts);
                  if (ctrlNode && ts.isIdentifier(ctrlNode)) {
                    controllerName = ctrlNode.text;
                    if (checker) {
                      controllerSymbol = checker.getSymbolAtLocation(ctrlNode);
                    }
                  }
                } else if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === "signal") {
                  if (checker) {
                    const valSym = checker.getShorthandAssignmentValueSymbol(prop) ?? checker.getSymbolAtLocation(prop.name);
                    if (valSym?.valueDeclaration && ts.isVariableDeclaration(valSym.valueDeclaration) && valSym.valueDeclaration.initializer) {
                      const ctrlNode = extractControllerNode(valSym.valueDeclaration.initializer, checker, ts);
                      if (ctrlNode && ts.isIdentifier(ctrlNode)) {
                        controllerName = ctrlNode.text;
                        controllerSymbol = checker.getSymbolAtLocation(ctrlNode);
                      }
                    }
                  }
                }
              }
            }

            addListeners.push({
              node: n,
              eventType,
              handlerName,
              isInlineHandler: isInline,
              controllerName,
              controllerSymbol,
            });
          }
        }

        // Look for return statement with cleanup function: return () => { ... }
        if (ts && ts.isReturnStatement(n) && n.expression) {
          const retExpr = n.expression;
          if (ts.isArrowFunction(retExpr) || ts.isFunctionExpression(retExpr)) {
            hasCleanupReturn = true;
            inspectCleanupBody(retExpr);
          }
        }

        // Don't recurse into nested function declarations (their returns aren't effect cleanups)
        if (ts && n !== effectCallback && (ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n))) {
          return;
        }

        n.forEachChild(inspectEffectBody);
      }

      function inspectCleanupBody(cleanupFn: tsType.Node) {
        function walkCleanup(cn: tsType.Node) {
          // 1. removeEventListener calls
          if (ts && ts.isCallExpression(cn) && ts.isPropertyAccessExpression(cn.expression) && cn.expression.name.text === "removeEventListener") {
            const args = cn.arguments;
            const eventTypeArg = args[0];
            const handlerArg = args[1];
            if (eventTypeArg && handlerArg) {
              const eventType = ts.isStringLiteral(eventTypeArg) ? eventTypeArg.text : "";
              const isInline = ts.isArrowFunction(handlerArg) || ts.isFunctionExpression(handlerArg);
              const handlerName = ts.isIdentifier(handlerArg) ? handlerArg.text : undefined;

              removeListeners.push({
                eventType,
                handlerName,
                isInlineHandler: isInline,
              });
            }
          }

          // 2. controller.abort() calls
          if (ts && ts.isCallExpression(cn) && ts.isPropertyAccessExpression(cn.expression) && cn.expression.name.text === "abort") {
            const abortReceiver = cn.expression.expression;
            if (isDOMAbortController(abortReceiver, checker, ts) && ts.isIdentifier(abortReceiver)) {
              abortedControllerNames.add(abortReceiver.text);
              if (checker) {
                const sym = checker.getSymbolAtLocation(abortReceiver);
                if (sym) {
                  abortedControllerSymbols.add(sym);
                }
              }
            }
          }

          cn.forEachChild(walkCleanup);
        }
        cleanupFn.forEachChild(walkCleanup);
      }

      inspectEffectBody(effectCallback.body);

      // Check each addListener against removeListeners and aborted controllers
      for (const listener of addListeners) {
        let isCleanedUp = false;

        if (hasCleanupReturn) {
          // 1. Check AbortController abort() cleanup
          if (listener.controllerSymbol && abortedControllerSymbols.has(listener.controllerSymbol)) {
            isCleanedUp = true;
          } else if (listener.controllerName && abortedControllerNames.has(listener.controllerName)) {
            isCleanedUp = true;
          }

          // 2. Check removeEventListener cleanup
          if (!isCleanedUp) {
            for (const rem of removeListeners) {
              if (listener.eventType && rem.eventType && listener.eventType === rem.eventType) {
                if (listener.isInlineHandler || rem.isInlineHandler) {
                  isCleanedUp = false;
                } else if (listener.handlerName && rem.handlerName && listener.handlerName === rem.handlerName) {
                  isCleanedUp = true;
                  break;
                }
              }
            }
          }
        }

        if (!isCleanedUp) {
          const range = getNodeSourceRange(listener.node, sourceFile);
          const detailMsg = listener.isInlineHandler && !listener.controllerName
            ? "Inline callback function in addEventListener cannot be removed because a new function reference is created."
            : hasCleanupReturn
            ? `Neither matching removeEventListener nor controller.abort() was found in the cleanup function.`
            : "No cleanup function was returned from the lifecycle hook.";

          context.report({
            ruleId: "browser/event-listener-cleanup",
            category: "browser",
            severity: "error",
            confidence: "high",
            message: `addEventListener for '${listener.eventType || "event"}' in lifecycle hook is missing matching cleanup.`,
            file: sourceFile.fileName,
            range,
            evidence: [
              {
                message: detailMsg,
                range,
              },
            ],
            suggestedAction:
              "Remove the event listener in cleanup (removeEventListener) or abort the associated AbortController (controller.abort()).",
            safeAutomaticFix: false,
          });
        }
      }
    });
  },
};
