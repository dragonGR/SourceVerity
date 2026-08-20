import type * as tsType from "typescript";
import { getNodeSourceRange, isReactLifecycleHookCall } from "../../engine/symbols.js";
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

      if (!isReactLifecycleHookCall(node, ts, checker)) return;

      const effectCallback = node.arguments[0];
      if (!effectCallback || (!ts.isArrowFunction(effectCallback) && !ts.isFunctionExpression(effectCallback))) {
        return;
      }

      const timers: Array<{
        node: tsType.CallExpression;
        timerKind: "setInterval" | "setTimeout";
        varName?: string | undefined;
        collectionName?: string | undefined;
      }> = [];

      const collections = new Map<
        string,
        {
          timerKind?: "setInterval" | "setTimeout" | "mixed" | undefined;
          count: number;
          hasNonTimerPush: boolean;
        }
      >();

      const scalarCleanups = new Set<string>();
      const cleanedCollections = new Map<string, "clearInterval" | "clearTimeout">();
      let hasCleanupReturn = false;

      function inspectEffectBody(n: tsType.Node) {
        // Look for: timers.push(setTimeout(...)) or timers.push(someValue)
        if (ts && ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
          const propAccess = n.expression;
          if (propAccess.name.text === "push" && ts.isIdentifier(propAccess.expression)) {
            const collName = propAccess.expression.text;
            let collInfo = collections.get(collName);
            if (!collInfo) {
              collInfo = { count: 0, hasNonTimerPush: false };
              collections.set(collName, collInfo);
            }

            for (const arg of n.arguments) {
              if (ts.isCallExpression(arg) && ts.isIdentifier(arg.expression)) {
                const fnName = arg.expression.text;
                if (fnName === "setInterval" || fnName === "setTimeout") {
                  timers.push({
                    node: arg,
                    timerKind: fnName,
                    collectionName: collName,
                  });
                  collInfo.count++;
                  if (!collInfo.timerKind) {
                    collInfo.timerKind = fnName;
                  } else if (collInfo.timerKind !== fnName) {
                    collInfo.timerKind = "mixed";
                  }
                  continue;
                }
              }
              // Non-timer pushed to this collection
              collInfo.hasNonTimerPush = true;
            }
          }
        }

        // Look for: const id = setInterval(...) or scalar setInterval(...)
        if (ts && ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
          const fnName = n.expression.text;
          if (fnName === "setInterval" || fnName === "setTimeout") {
            // Check if this was already captured as a collection push argument
            const isPushed =
              n.parent &&
              ts.isCallExpression(n.parent) &&
              ts.isPropertyAccessExpression(n.parent.expression) &&
              n.parent.expression.name.text === "push";

            if (!isPushed) {
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
        }

        // Check for return statement in effect callback
        if (ts && ts.isReturnStatement(n) && n.expression) {
          const retExpr = n.expression;
          if (ts.isArrowFunction(retExpr) || ts.isFunctionExpression(retExpr)) {
            hasCleanupReturn = true;
            inspectCleanupBody(retExpr);
          }
        }

        // Continue traversal (descend into inner callbacks/loops such as forEach to find pushed timers)
        if (ts && n !== effectCallback && ts.isReturnStatement(n)) {
          return;
        }

        n.forEachChild(inspectEffectBody);
      }

      function inspectCleanupBody(cleanupFn: tsType.Node) {
        function walkCleanup(cn: tsType.Node) {
          if (!ts) return;

          // 1. Direct scalar call: clearTimeout(id) or clearInterval(id)
          if (ts.isCallExpression(cn) && ts.isIdentifier(cn.expression)) {
            const fnName = cn.expression.text;
            if (fnName === "clearInterval" || fnName === "clearTimeout") {
              scalarCleanups.add(fnName);
              const arg = cn.arguments[0];
              if (arg && ts.isIdentifier(arg)) {
                scalarCleanups.add(arg.text);
              }
            }
          }

          // 2. Collection forEach: timers.forEach(clearTimeout) or timers.forEach((id) => clearTimeout(id))
          if (
            ts.isCallExpression(cn) &&
            ts.isPropertyAccessExpression(cn.expression) &&
            cn.expression.name.text === "forEach" &&
            ts.isIdentifier(cn.expression.expression)
          ) {
            const collName = cn.expression.expression.text;
            const firstArg = cn.arguments[0];

            // Pattern 2a: Point-free: timers.forEach(clearTimeout) / timers.forEach(clearInterval)
            if (firstArg && ts.isIdentifier(firstArg)) {
              const clearerName = firstArg.text;
              if (clearerName === "clearTimeout" || clearerName === "clearInterval") {
                cleanedCollections.set(collName, clearerName);
              }
            }

            // Pattern 2b: Callback: timers.forEach((id) => clearTimeout(id))
            if (firstArg && (ts.isArrowFunction(firstArg) || ts.isFunctionExpression(firstArg))) {
              const param = firstArg.parameters[0];
              if (param && ts.isIdentifier(param.name)) {
                const paramName = param.name.text;
                let foundClearer: "clearTimeout" | "clearInterval" | undefined;

                function findCallbackClear(inner: tsType.Node) {
                  if (foundClearer || !ts) return;
                  if (ts.isCallExpression(inner) && ts.isIdentifier(inner.expression)) {
                    const fnName = inner.expression.text;
                    if (fnName === "clearTimeout" || fnName === "clearInterval") {
                      const arg = inner.arguments[0];
                      if (arg && ts.isIdentifier(arg) && arg.text === paramName) {
                        foundClearer = fnName;
                      }
                    }
                  }
                  inner.forEachChild(findCallbackClear);
                }

                findCallbackClear(firstArg.body);
                if (foundClearer) {
                  cleanedCollections.set(collName, foundClearer);
                }
              }
            }
          }

          // 3. For...of loop: for (const timer of timers) clearTimeout(timer);
          if (ts.isForOfStatement(cn)) {
            const expression = cn.expression;
            if (ts.isIdentifier(expression)) {
              const collName = expression.text;
              let loopVarName: string | undefined;
              if (ts.isVariableDeclarationList(cn.initializer)) {
                const decl = cn.initializer.declarations[0];
                if (decl && ts.isIdentifier(decl.name)) {
                  loopVarName = decl.name.text;
                }
              } else if (ts.isIdentifier(cn.initializer)) {
                loopVarName = cn.initializer.text;
              }

              if (loopVarName) {
                let foundClearer: "clearTimeout" | "clearInterval" | undefined;
                function findForOfClear(inner: tsType.Node) {
                  if (foundClearer || !ts) return;
                  if (ts.isCallExpression(inner) && ts.isIdentifier(inner.expression)) {
                    const fnName = inner.expression.text;
                    if (fnName === "clearTimeout" || fnName === "clearInterval") {
                      const arg = inner.arguments[0];
                      if (arg && ts.isIdentifier(arg) && arg.text === loopVarName) {
                        foundClearer = fnName;
                      }
                    }
                  }
                  inner.forEachChild(findForOfClear);
                }
                findForOfClear(cn.statement);
                if (foundClearer) {
                  cleanedCollections.set(collName, foundClearer);
                }
              }
            }
          }

          // 4. Classic for loop: for (let i = 0; i < timers.length; i++) clearTimeout(timers[i]);
          if (ts.isForStatement(cn)) {
            let collName: string | undefined;
            if (
              cn.condition &&
              ts.isBinaryExpression(cn.condition) &&
              ts.isPropertyAccessExpression(cn.condition.right) &&
              cn.condition.right.name.text === "length" &&
              ts.isIdentifier(cn.condition.right.expression)
            ) {
              collName = cn.condition.right.expression.text;
            }

            if (collName) {
              let foundClearer: "clearTimeout" | "clearInterval" | undefined;
              function findForClear(inner: tsType.Node) {
                if (foundClearer || !ts) return;
                if (ts.isCallExpression(inner) && ts.isIdentifier(inner.expression)) {
                  const fnName = inner.expression.text;
                  if (fnName === "clearTimeout" || fnName === "clearInterval") {
                    const arg = inner.arguments[0];
                    if (
                      arg &&
                      ts.isElementAccessExpression(arg) &&
                      ts.isIdentifier(arg.expression) &&
                      arg.expression.text === collName
                    ) {
                      foundClearer = fnName;
                    }
                  }
                }
                inner.forEachChild(findForClear);
              }
              findForClear(cn.statement);
              if (foundClearer) {
                cleanedCollections.set(collName, foundClearer);
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
        const expectedClear = timer.timerKind === "setInterval" ? "clearInterval" : "clearTimeout";

        if (hasCleanupReturn) {
          if (timer.collectionName) {
            const collInfo = collections.get(timer.collectionName);
            const cleanedWith = cleanedCollections.get(timer.collectionName);
            if (collInfo && !collInfo.hasNonTimerPush && cleanedWith === expectedClear) {
              isCleaned = true;
            }
          } else if (timer.varName) {
            if (scalarCleanups.has(expectedClear) && scalarCleanups.has(timer.varName)) {
              isCleaned = true;
            }
          } else {
            // Bare timer without variable or collection name
            if (scalarCleanups.has(expectedClear)) {
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
                message: isInterval
                  ? "An uncleared interval continues executing after the owning component has unmounted, retaining its callback and performing unnecessary background work."
                  : "A pending timeout may fire after the component has unmounted and execute stale lifecycle work.",
                range,
              },
            ],
            suggestedAction: isInterval
              ? `Clear the interval in the returned cleanup function: return () => clearInterval(${timer.varName ?? "id"});`
              : "Store the timeout handle and clear it in the effect cleanup when post-unmount execution is not intended.",
            safeAutomaticFix: false,
          });
        }
      }
    });
  },
};
