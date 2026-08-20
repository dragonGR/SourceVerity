import type * as tsType from "typescript";
import { getNodeSourceRange, isReactLifecycleHookCall, isDOMEventTarget, isDOMAbortController } from "../../engine/symbols.js";
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

      if (!isReactLifecycleHookCall(node, ts, checker)) return;

      const effectCallback = node.arguments[0];
      if (!effectCallback || (!ts.isArrowFunction(effectCallback) && !ts.isFunctionExpression(effectCallback))) {
        return;
      }

      interface EventExpressionInfo {
        readonly rawText: string;
        readonly literalValue?: string | undefined;
        readonly symbol?: tsType.Symbol | undefined;
        readonly rootSymbol?: tsType.Symbol | undefined;
      }

      interface HandlerExpressionInfo {
        readonly isInlineHandler: boolean;
        readonly handlerName?: string | undefined;
        readonly symbol?: tsType.Symbol | undefined;
      }

      interface TargetExpressionInfo {
        readonly text: string;
        readonly symbol?: tsType.Symbol | undefined;
      }

      function resolveEventExpression(
        expr: tsType.Expression,
        chk: tsType.TypeChecker | undefined,
        t: typeof tsType
      ): EventExpressionInfo {
        let current: tsType.Expression = expr;
        while (t.isParenthesizedExpression(current)) {
          current = current.expression;
        }

        if (t.isStringLiteral(current) || t.isNoSubstitutionTemplateLiteral(current)) {
          return {
            rawText: current.text,
            literalValue: current.text,
          };
        }

        if (t.isIdentifier(current)) {
          const rawText = current.text;
          if (!chk) {
            return { rawText };
          }

          const sym = chk.getSymbolAtLocation(current);
          let rootSym = sym;
          if (rootSym && (rootSym.flags & t.SymbolFlags.Alias) !== 0) {
            try {
              rootSym = chk.getAliasedSymbol(rootSym);
            } catch {
              // ignore
            }
          }

          let literalValue: string | undefined;
          let targetSym = sym;
          const visitedSyms = new Set<tsType.Symbol>();
          while (targetSym && !visitedSyms.has(targetSym)) {
            visitedSyms.add(targetSym);
            const decl = targetSym.valueDeclaration ?? targetSym.declarations?.[0];
            if (decl && t.isVariableDeclaration(decl) && decl.initializer) {
              let init = decl.initializer;
              while (t.isParenthesizedExpression(init)) {
                init = init.expression;
              }
              if (t.isStringLiteral(init) || t.isNoSubstitutionTemplateLiteral(init)) {
                literalValue = init.text;
                break;
              } else if (t.isIdentifier(init)) {
                const nextSym = chk.getSymbolAtLocation(init);
                if (nextSym) {
                  targetSym = nextSym;
                  if (!rootSym) rootSym = nextSym;
                  continue;
                }
              }
            }
            break;
          }

          if (literalValue === undefined) {
            try {
              const type = chk.getTypeAtLocation(current);
              if (type.isStringLiteral()) {
                literalValue = type.value;
              }
            } catch {
              // ignore
            }
          }

          return {
            rawText,
            literalValue,
            symbol: sym,
            rootSymbol: rootSym,
          };
        }

        if (t.isPropertyAccessExpression(current)) {
          const rawText = current.getText();
          let literalValue: string | undefined;
          let sym: tsType.Symbol | undefined;
          let rootSym: tsType.Symbol | undefined;

          if (chk) {
            sym = chk.getSymbolAtLocation(current);
            rootSym = sym;
            try {
              const type = chk.getTypeAtLocation(current);
              if (type.isStringLiteral()) {
                literalValue = type.value;
              }
            } catch {
              // ignore
            }
          }

          return {
            rawText,
            literalValue,
            symbol: sym,
            rootSymbol: rootSym,
          };
        }

        return {
          rawText: current.getText(),
        };
      }

      function areEventExpressionsIdentical(
        addInfo: EventExpressionInfo,
        remInfo: EventExpressionInfo
      ): boolean {
        if (addInfo.literalValue !== undefined && remInfo.literalValue !== undefined) {
          return addInfo.literalValue === remInfo.literalValue;
        }
        if (addInfo.rootSymbol && remInfo.rootSymbol && addInfo.rootSymbol === remInfo.rootSymbol) {
          return true;
        }
        if (addInfo.symbol && remInfo.symbol && addInfo.symbol === remInfo.symbol) {
          return true;
        }
        if (addInfo.rawText && remInfo.rawText && addInfo.rawText === remInfo.rawText) {
          return true;
        }
        return false;
      }

      function resolveHandlerExpression(
        expr: tsType.Expression,
        chk: tsType.TypeChecker | undefined,
        t: typeof tsType
      ): HandlerExpressionInfo {
        let current: tsType.Expression = expr;
        while (t.isParenthesizedExpression(current)) {
          current = current.expression;
        }

        if (t.isArrowFunction(current) || t.isFunctionExpression(current)) {
          return { isInlineHandler: true };
        }

        if (t.isIdentifier(current)) {
          const sym = chk ? chk.getSymbolAtLocation(current) : undefined;
          return {
            isInlineHandler: false,
            handlerName: current.text,
            symbol: sym,
          };
        }

        return {
          isInlineHandler: false,
          handlerName: current.getText(),
          symbol: chk ? chk.getSymbolAtLocation(current) : undefined,
        };
      }

      function areHandlersIdentical(
        addHandler: HandlerExpressionInfo,
        remHandler: HandlerExpressionInfo
      ): boolean {
        if (addHandler.isInlineHandler || remHandler.isInlineHandler) {
          return false;
        }
        if (addHandler.symbol && remHandler.symbol && addHandler.symbol === remHandler.symbol) {
          return true;
        }
        if (addHandler.handlerName && remHandler.handlerName && addHandler.handlerName === remHandler.handlerName) {
          return true;
        }
        return false;
      }

      function resolveTargetExpression(
        expr: tsType.Expression,
        chk: tsType.TypeChecker | undefined,
        t: typeof tsType
      ): TargetExpressionInfo {
        let current: tsType.Expression = expr;
        while (t.isParenthesizedExpression(current)) {
          current = current.expression;
        }
        const text = current.getText();
        const symbol = chk ? chk.getSymbolAtLocation(current) : undefined;
        return { text, symbol };
      }

      function areTargetsIdentical(
        addTarget: TargetExpressionInfo,
        remTarget: TargetExpressionInfo
      ): boolean {
        if (addTarget.symbol && remTarget.symbol && addTarget.symbol === remTarget.symbol) {
          return true;
        }
        return addTarget.text === remTarget.text;
      }

      // Collect addEventListener calls inside the effect callback
      interface AddListenerInfo {
        readonly node: tsType.CallExpression;
        readonly targetInfo: TargetExpressionInfo;
        readonly eventInfo: EventExpressionInfo;
        readonly handlerInfo: HandlerExpressionInfo;
        readonly controllerName?: string | undefined;
        readonly controllerSymbol?: tsType.Symbol | undefined;
      }

      const addListeners: AddListenerInfo[] = [];

      // Collect removeEventListener calls inside cleanup returns
      interface RemoveListenerInfo {
        readonly targetInfo: TargetExpressionInfo;
        readonly eventInfo: EventExpressionInfo;
        readonly handlerInfo: HandlerExpressionInfo;
      }

      const removeListeners: RemoveListenerInfo[] = [];
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
            const targetInfo = resolveTargetExpression(target, checker, ts);
            const eventInfo = resolveEventExpression(eventTypeArg, checker, ts);
            const handlerInfo = resolveHandlerExpression(handlerArg, checker, ts);

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
              targetInfo,
              eventInfo,
              handlerInfo,
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
            const target = cn.expression.expression;
            const args = cn.arguments;
            const eventTypeArg = args[0];
            const handlerArg = args[1];
            if (eventTypeArg && handlerArg) {
              const targetInfo = resolveTargetExpression(target, checker, ts);
              const eventInfo = resolveEventExpression(eventTypeArg, checker, ts);
              const handlerInfo = resolveHandlerExpression(handlerArg, checker, ts);

              removeListeners.push({
                targetInfo,
                eventInfo,
                handlerInfo,
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
              if (
                areTargetsIdentical(listener.targetInfo, rem.targetInfo) &&
                areEventExpressionsIdentical(listener.eventInfo, rem.eventInfo)
              ) {
                if (listener.handlerInfo.isInlineHandler || rem.handlerInfo.isInlineHandler) {
                  isCleanedUp = false;
                } else if (areHandlersIdentical(listener.handlerInfo, rem.handlerInfo)) {
                  isCleanedUp = true;
                  break;
                }
              }
            }
          }
        }

        if (!isCleanedUp) {
          const range = getNodeSourceRange(listener.node, sourceFile);
          const detailMsg = listener.handlerInfo.isInlineHandler && !listener.controllerName
            ? "Inline callback function in addEventListener cannot be removed because a new function reference is created."
            : hasCleanupReturn
            ? `Neither matching removeEventListener nor controller.abort() was found in the cleanup function.`
            : "No cleanup function was returned from the lifecycle hook.";

          const eventDisplay = listener.eventInfo.literalValue ?? listener.eventInfo.rawText ?? "event";

          context.report({
            ruleId: "browser/event-listener-cleanup",
            category: "browser",
            severity: "error",
            confidence: "high",
            message: `addEventListener for '${eventDisplay}' in lifecycle hook is missing matching cleanup.`,
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
