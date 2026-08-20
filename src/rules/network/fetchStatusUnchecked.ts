import type * as tsType from "typescript";
import { getNodeSourceRange, isDOMGlobal } from "../../engine/symbols.js";
import { unwrapExpression } from "../../analysis/values.js";
import { hasVariableReassignment, statementExitsControlFlow } from "../../analysis/controlFlow.js";
import type { Rule, RuleContext } from "../../core/types.js";

type StatusCheckPolarity = "positive" | "negative";

const BODY_CONSUMPTION_METHODS: Record<string, true> = {
  json: true,
  text: true,
  blob: true,
  arrayBuffer: true,
  formData: true,
  bytes: true,
};

function isMatchingTarget(
  expr: tsType.Expression,
  targetSymbol: tsType.Symbol | undefined,
  targetName: string,
  ts: typeof tsType,
  checker: tsType.TypeChecker
): boolean {
  const unwrapped = unwrapExpression(expr, ts);
  if (!ts.isIdentifier(unwrapped)) return false;
  if (targetSymbol) {
    let sym = checker.getSymbolAtLocation(unwrapped);
    if (sym && (sym.flags & ts.SymbolFlags.Alias) !== 0) {
      try {
        sym = checker.getAliasedSymbol(sym);
      } catch {}
    }
    return sym === targetSymbol;
  }
  return unwrapped.text === targetName;
}

function classifyStatusCheck(
  rawExpr: tsType.Expression,
  targetSymbol: tsType.Symbol | undefined,
  targetName: string,
  ts: typeof tsType,
  checker: tsType.TypeChecker
): StatusCheckPolarity | undefined {
  const expr = unwrapExpression(rawExpr, ts);

  // 1. !res.ok -> negative
  if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.ExclamationToken) {
    const inner = unwrapExpression(expr.operand, ts);
    if (ts.isPropertyAccessExpression(inner) && inner.name.text === "ok") {
      if (isMatchingTarget(inner.expression, targetSymbol, targetName, ts, checker)) {
        return "negative";
      }
    }
  }

  // 2. res.ok -> positive
  if (ts.isPropertyAccessExpression(expr) && expr.name.text === "ok") {
    if (isMatchingTarget(expr.expression, targetSymbol, targetName, ts, checker)) {
      return "positive";
    }
  }

  // 3. Binary expressions
  if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind;

    // Logical AND: check if positive guard (e.g. res.ok && ...)
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
      const leftPol = classifyStatusCheck(expr.left, targetSymbol, targetName, ts, checker);
      const rightPol = classifyStatusCheck(expr.right, targetSymbol, targetName, ts, checker);
      if (leftPol === "positive" || rightPol === "positive") {
        return "positive";
      }
    }

    // Logical OR: check if negative guard (e.g. !res.ok || res.status !== 200)
    if (op === ts.SyntaxKind.BarBarToken) {
      const leftPol = classifyStatusCheck(expr.left, targetSymbol, targetName, ts, checker);
      const rightPol = classifyStatusCheck(expr.right, targetSymbol, targetName, ts, checker);
      if (leftPol === "negative" || rightPol === "negative") {
        return "negative";
      }
    }

    // Equality/inequality on res.ok or res.status
    if (
      op === ts.SyntaxKind.EqualsEqualsToken ||
      op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsEqualsToken
    ) {
      const isEq = op === ts.SyntaxKind.EqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsEqualsToken;

      const left = unwrapExpression(expr.left, ts);
      const right = unwrapExpression(expr.right, ts);

      let propAccess: tsType.PropertyAccessExpression | undefined;
      let otherSide: tsType.Expression | undefined;

      if (ts.isPropertyAccessExpression(left) && isMatchingTarget(left.expression, targetSymbol, targetName, ts, checker)) {
        propAccess = left;
        otherSide = right;
      } else if (ts.isPropertyAccessExpression(right) && isMatchingTarget(right.expression, targetSymbol, targetName, ts, checker)) {
        propAccess = right;
        otherSide = left;
      }

      if (propAccess) {
        if (propAccess.name.text === "ok") {
          if (otherSide && otherSide.kind === ts.SyntaxKind.TrueKeyword) {
            return isEq ? "positive" : "negative";
          }
          if (otherSide && otherSide.kind === ts.SyntaxKind.FalseKeyword) {
            return isEq ? "negative" : "positive";
          }
        }

        if (propAccess.name.text === "status") {
          if (otherSide && ts.isNumericLiteral(otherSide)) {
            const code = parseInt(otherSide.text, 10);
            if (code >= 200 && code < 300) {
              return isEq ? "positive" : "negative";
            }
            if (code >= 400) {
              return isEq ? "negative" : "positive";
            }
          }
        }
      }
    }

    // Range comparisons on res.status
    if (
      op === ts.SyntaxKind.LessThanToken ||
      op === ts.SyntaxKind.LessThanEqualsToken ||
      op === ts.SyntaxKind.GreaterThanToken ||
      op === ts.SyntaxKind.GreaterThanEqualsToken
    ) {
      const left = unwrapExpression(expr.left, ts);
      const right = unwrapExpression(expr.right, ts);
      if (
        ts.isPropertyAccessExpression(left) &&
        left.name.text === "status" &&
        isMatchingTarget(left.expression, targetSymbol, targetName, ts, checker)
      ) {
        if (ts.isNumericLiteral(right)) {
          const num = parseInt(right.text, 10);
          if (op === ts.SyntaxKind.LessThanToken || op === ts.SyntaxKind.LessThanEqualsToken) {
            return num >= 300 ? "positive" : "negative";
          }
          if (op === ts.SyntaxKind.GreaterThanToken || op === ts.SyntaxKind.GreaterThanEqualsToken) {
            return num >= 400 ? "negative" : "positive";
          }
        }
      }
    }
  }

  return undefined;
}

function isBodyConsumptionDominatedByCheck(
  consumptionNode: tsType.Node,
  resDeclNode: tsType.VariableDeclaration,
  targetSymbol: tsType.Symbol | undefined,
  targetName: string,
  scope: tsType.Node,
  ts: typeof tsType,
  checker: tsType.TypeChecker
): boolean {
  const isConst = (resDeclNode.parent.flags & ts.NodeFlags.Const) !== 0;

  function isReassigned(startPos: number, endPos: number): boolean {
    if (isConst) return false;
    return hasVariableReassignment(scope, targetName, targetSymbol, ts, checker, endPos, startPos);
  }

  // 1. Ancestor branch checks
  let curr: tsType.Node = consumptionNode;
  while (curr.parent && curr !== scope) {
    const parent: tsType.Node = curr.parent;

    if (ts.isIfStatement(parent)) {
      const expected = parent.thenStatement === curr ? "positive" : parent.elseStatement === curr ? "negative" : undefined;
      if (expected && classifyStatusCheck(parent.expression, targetSymbol, targetName, ts, checker) === expected) {
        if (!isReassigned(parent.getStart(), consumptionNode.getStart())) {
          return true;
        }
      }
    }

    if (ts.isConditionalExpression(parent)) {
      const expected = parent.whenTrue === curr ? "positive" : parent.whenFalse === curr ? "negative" : undefined;
      if (expected && classifyStatusCheck(parent.condition, targetSymbol, targetName, ts, checker) === expected) {
        return true;
      }
    }

    if (ts.isCaseClause(parent)) {
      const switchStmt = parent.parent?.parent;
      if (switchStmt && ts.isSwitchStatement(switchStmt)) {
        const switchExpr = unwrapExpression(switchStmt.expression, ts);
        if (
          ts.isPropertyAccessExpression(switchExpr) &&
          switchExpr.name.text === "status" &&
          isMatchingTarget(switchExpr.expression, targetSymbol, targetName, ts, checker)
        ) {
          if (parent.expression && ts.isNumericLiteral(parent.expression)) {
            const code = parseInt(parent.expression.text, 10);
            if (code >= 200 && code < 300) {
              return true;
            }
          }
        }
      }
    }

    curr = parent;
  }

  // 2. Preceding early-exit guard in enclosing statement block
  let nodeToFindStmt: tsType.Node = consumptionNode;
  while (nodeToFindStmt.parent && nodeToFindStmt !== scope) {
    const container: tsType.Node = nodeToFindStmt.parent;
    if (ts.isBlock(container) || ts.isSourceFile(container)) {
      const stmts = container.statements;
      let stmtContainingConsumption: tsType.Statement | undefined;
      for (const s of stmts) {
        if (consumptionNode.getStart() >= s.getStart() && consumptionNode.getEnd() <= s.getEnd()) {
          stmtContainingConsumption = s;
          break;
        }
      }

      if (stmtContainingConsumption) {
        const idx = stmts.indexOf(stmtContainingConsumption);
        for (let i = 0; i < idx; i++) {
          const prevStmt = stmts[i];
          if (!prevStmt || prevStmt.getStart() < resDeclNode.getStart()) continue;

          if (ts.isIfStatement(prevStmt)) {
            const pol = classifyStatusCheck(prevStmt.expression, targetSymbol, targetName, ts, checker);
            if (pol === "negative" && statementExitsControlFlow(prevStmt.thenStatement, ts) && !prevStmt.elseStatement) {
              if (!isReassigned(prevStmt.getEnd(), consumptionNode.getStart())) {
                return true;
              }
            }
          }
        }
      }
    }
    nodeToFindStmt = container;
  }

  return false;
}

export const fetchStatusUncheckedRule: Rule = {
  meta: {
    id: "network/fetch-status-unchecked",
    category: "network",
    defaultSeverity: "warning",
    defaultConfidence: "high",
    description: "Detects consumption of fetch() response bodies without checking response.ok or status.",
    requiresTypeInformation: true,
  },

  analyze(context: RuleContext): void {
    const { sourceFile, checker, ts } = context;
    if (!checker || !ts) return;
    const typeChecker = checker;
    const tsLib = ts;

    context.visitNodes((node: tsType.Node) => {
      if (!tsLib.isVariableDeclaration(node)) return;
      if (!tsLib.isIdentifier(node.name)) return;
      const resVarName = node.name.text;

      const init = node.initializer;
      if (!init) return;

      let callExpr: tsType.CallExpression | undefined;
      if (tsLib.isAwaitExpression(init) && tsLib.isCallExpression(init.expression)) {
        callExpr = init.expression;
      } else if (tsLib.isCallExpression(init)) {
        callExpr = init;
      }

      if (!callExpr) return;

      let isFetchCall = false;
      if (tsLib.isIdentifier(callExpr.expression) && callExpr.expression.text === "fetch") {
        if (isDOMGlobal(callExpr.expression, typeChecker, "fetch")) {
          isFetchCall = true;
        }
      } else if (
        tsLib.isPropertyAccessExpression(callExpr.expression) &&
        callExpr.expression.name.text === "fetch" &&
        tsLib.isIdentifier(callExpr.expression.expression) &&
        (callExpr.expression.expression.text === "window" || callExpr.expression.expression.text === "globalThis")
      ) {
        isFetchCall = true;
      }

      if (!isFetchCall) return;

      const targetSymbol = typeChecker.getSymbolAtLocation(node.name);

      const scope = context.findEnclosingScope(node);
      if (!scope) return;

      const bodyConsumptionNodes: Array<{ node: tsType.Node; methodName: string }> = [];

      function collectConsumptions(n: tsType.Node) {
        if (tsLib.isPropertyAccessExpression(n)) {
          if (isMatchingTarget(n.expression, targetSymbol, resVarName, tsLib, typeChecker)) {
            const prop = n.name.text;
            if (BODY_CONSUMPTION_METHODS[prop]) {
              bodyConsumptionNodes.push({ node: n, methodName: prop });
            }
          }
        }
        n.forEachChild(collectConsumptions);
      }

      collectConsumptions(scope);

      for (const consumption of bodyConsumptionNodes) {
        const isDominated = isBodyConsumptionDominatedByCheck(
          consumption.node,
          node,
          targetSymbol,
          resVarName,
          scope,
          tsLib,
          typeChecker
        );

        if (!isDominated) {
          const range = getNodeSourceRange(consumption.node, sourceFile);
          context.report({
            ruleId: "network/fetch-status-unchecked",
            category: "network",
            severity: "warning",
            confidence: "high",
            message: `Response body consumed via .${consumption.methodName}() without checking response.ok or response.status.`,
            file: sourceFile.fileName,
            range,
            evidence: [
              {
                message: "fetch() does not reject on HTTP 4xx or 5xx status codes.",
                range,
              },
            ],
            suggestedAction: "Check `if (response.ok)` or verify `response.status` before consuming the response body.",
            safeAutomaticFix: false,
          });
        }
      }
    });
  },
};
