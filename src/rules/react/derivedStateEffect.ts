import type * as tsType from "typescript";
import { getNodeSourceRange, isReactLifecycleHookCall } from "../../engine/symbols.js";
import { isResetValue, resolveConstantValue, unwrapExpression } from "../../analysis/values.js";
import type { Rule, RuleContext } from "../../core/types.js";

/**
 * Collects all identifier names referenced within an AST node, following local const variable initializers.
 */
function collectReferencedIdentifiers(
  node: tsType.Node,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): Set<string> {
  const names = new Set<string>();
  const visitedSymbols = new Set<tsType.Symbol>();

  function walk(n: tsType.Node) {
    if (ts.isIdentifier(n)) {
      names.add(n.text);
      if (checker) {
        const sym = checker.getSymbolAtLocation(n);
        if (sym && !visitedSymbols.has(sym)) {
          visitedSymbols.add(sym);
          const decl = sym.valueDeclaration ?? sym.declarations?.[0];
          if (decl && ts.isVariableDeclaration(decl) && decl.initializer) {
            walk(decl.initializer);
          }
        }
      }
    }
    n.forEachChild(walk);
  }
  walk(node);
  return names;
}

/**
 * Extracts dependency identifier names from a React hook dependency array (e.g. `[a, b.c, d]`).
 */
function extractDependencyNames(depsArg: tsType.Expression, ts: typeof tsType): Set<string> {
  const depNames = new Set<string>();
  const unwrapped = unwrapExpression(depsArg, ts);

  if (ts.isArrayLiteralExpression(unwrapped)) {
    for (const elem of unwrapped.elements) {
      const u = unwrapExpression(elem, ts);
      if (ts.isIdentifier(u)) {
        depNames.add(u.text);
      } else if (ts.isPropertyAccessExpression(u)) {
        // e.g. props.value -> collect 'props' and 'value'
        const base = unwrapExpression(u.expression, ts);
        if (ts.isIdentifier(base)) {
          depNames.add(base.text);
        }
      }
    }
  }

  return depNames;
}

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

      if (!isReactLifecycleHookCall(node, ts, checker)) return;

      const args = node.arguments;
      if (!args || args.length === 0) return;

      const callback = args[0];
      if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) {
        return;
      }

      // Inspect statements in effect body
      const body = callback.body;
      let setterCallExpr: tsType.CallExpression | undefined;
      let setterName = "";

      if (ts.isBlock(body)) {
        const stmts = body.statements;
        if (stmts.length === 1 && stmts[0] && ts.isExpressionStatement(stmts[0])) {
          const expr = unwrapExpression(stmts[0].expression, ts);
          if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
            const fnName = expr.expression.text;
            if (/^set[A-Z]/.test(fnName)) {
              setterCallExpr = expr;
              setterName = fnName;
            }
          }
        }
      } else if (ts.isCallExpression(body)) {
        const unwrappedBody = unwrapExpression(body, ts);
        if (ts.isCallExpression(unwrappedBody) && ts.isIdentifier(unwrappedBody.expression)) {
          const fnName = unwrappedBody.expression.text;
          if (/^set[A-Z]/.test(fnName)) {
            setterCallExpr = unwrappedBody;
            setterName = fnName;
          }
        }
      }

      if (!setterCallExpr) return;

      const setterArgs = setterCallExpr.arguments;
      if (setterArgs.length === 0) return;

      const setterArg = setterArgs[0];
      if (!setterArg) return;

      // 1. Exclude functional state updates: setState(prev => prev + 1)
      const unwrappedArg = unwrapExpression(setterArg, ts);
      if (ts.isArrowFunction(unwrappedArg) || ts.isFunctionExpression(unwrappedArg)) {
        return;
      }

      // 2. Exclude state resets: setState(0), setState(""), setState(null), setState(DEFAULT_STATE where DEFAULT_STATE is static)
      if (isResetValue(unwrappedArg, ts, checker)) {
        return;
      }

      // 3. Exclude static literals/constants that do not depend on effect dependencies
      const constantVal = resolveConstantValue(unwrappedArg, ts, checker);
      if (constantVal.isStatic) {
        return;
      }

      // 4. If dependency array exists, check whether setter argument actually references any dependency (including through local aliases)
      const depsArg = args[1];
      if (depsArg) {
        const deps = extractDependencyNames(depsArg, ts);
        const referencedInArg = collectReferencedIdentifiers(unwrappedArg, ts, checker);

        // Check if any referenced variable in the setter expression is part of the dependencies
        let dependsOnDependencies = false;
        for (const ref of referencedInArg) {
          if (deps.has(ref)) {
            dependsOnDependencies = true;
            break;
          }
        }

        // If the setter value does not depend on any Effect dependency, it is a state reset / trigger,
        // not a derived state synchronization.
        if (!dependsOnDependencies && deps.size > 0) {
          return;
        }
      }

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
    });
  },
};
