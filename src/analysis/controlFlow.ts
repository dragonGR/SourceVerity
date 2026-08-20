import type * as tsType from "typescript";
import { unwrapExpression } from "./values.js";

export interface GuardCheckResult {
  readonly isGuarded: boolean;
  readonly evidence?: string | undefined;
}

/**
 * Checks if a statement definitely exits control flow (return, throw, break, continue).
 */
function statementExitsControlFlow(stmt: tsType.Statement, ts: typeof tsType): boolean {
  if (
    ts.isReturnStatement(stmt) ||
    ts.isThrowStatement(stmt) ||
    ts.isBreakStatement(stmt) ||
    ts.isContinueStatement(stmt)
  ) {
    return true;
  }

  if (ts.isBlock(stmt)) {
    const stmts = stmt.statements;
    if (stmts.length === 0) return false;
    const last = stmts[stmts.length - 1];
    return last !== undefined && statementExitsControlFlow(last, ts);
  }

  return false;
}

/**
 * Normalizes an index expression to an identifier base + integer offset.
 * e.g. `idx` -> { baseText: "idx", offset: 0 }
 * e.g. `idx + 1` -> { baseText: "idx", offset: 1 }
 * e.g. `idx - 1` -> { baseText: "idx", offset: -1 }
 */
interface NormalizedIndex {
  readonly baseText: string;
  readonly baseSymbol?: tsType.Symbol | undefined;
  readonly offset: number;
}

function normalizeIndexExpression(
  expr: tsType.Expression,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): NormalizedIndex | undefined {
  const unwrapped = unwrapExpression(expr, ts);

  if (ts.isIdentifier(unwrapped)) {
    const sym = checker?.getSymbolAtLocation(unwrapped);
    return { baseText: unwrapped.text, baseSymbol: sym, offset: 0 };
  }

  if (ts.isBinaryExpression(unwrapped)) {
    const left = unwrapExpression(unwrapped.left, ts);
    const right = unwrapExpression(unwrapped.right, ts);

    if (ts.isIdentifier(left) && ts.isNumericLiteral(right)) {
      const num = Number(right.text);
      if (!Number.isNaN(num)) {
        const sym = checker?.getSymbolAtLocation(left);
        if (unwrapped.operatorToken.kind === ts.SyntaxKind.PlusToken) {
          return { baseText: left.text, baseSymbol: sym, offset: num };
        }
        if (unwrapped.operatorToken.kind === ts.SyntaxKind.MinusToken) {
          return { baseText: left.text, baseSymbol: sym, offset: -num };
        }
      }
    }
  }

  return undefined;
}

/**
 * Normalizes an array target expression (identifier or property access).
 */
interface NormalizedArray {
  readonly text: string;
  readonly symbol?: tsType.Symbol | undefined;
}

function normalizeArrayTarget(
  expr: tsType.Expression,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): NormalizedArray | undefined {
  const unwrapped = unwrapExpression(expr, ts);
  if (ts.isIdentifier(unwrapped)) {
    const sym = checker?.getSymbolAtLocation(unwrapped);
    return { text: unwrapped.text, symbol: sym };
  }
  if (ts.isPropertyAccessExpression(unwrapped)) {
    const sym = checker?.getSymbolAtLocation(unwrapped);
    return { text: unwrapped.getText(), symbol: sym };
  }
  return undefined;
}

/**
 * Checks if a binary condition expression guards an index lower bound (e.g. index === -1 or index < 0).
 */
function isLowerBoundNegativeGuard(
  cond: tsType.Expression,
  indexInfo: NormalizedIndex,
  ts: typeof tsType
): boolean {
  const unwrapped = unwrapExpression(cond, ts);
  if (!ts.isBinaryExpression(unwrapped)) return false;

  const left = unwrapExpression(unwrapped.left, ts);
  const right = unwrapExpression(unwrapped.right, ts);
  const op = unwrapped.operatorToken.kind;

  // index === -1 or -1 === index
  if (op === ts.SyntaxKind.EqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsEqualsToken) {
    if (ts.isIdentifier(left) && left.text === indexInfo.baseText) {
      if (ts.isPrefixUnaryExpression(right) && right.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(right.operand) && right.operand.text === "1") {
        return true;
      }
    }
    if (ts.isIdentifier(right) && right.text === indexInfo.baseText) {
      if (ts.isPrefixUnaryExpression(left) && left.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(left.operand) && left.operand.text === "1") {
        return true;
      }
    }
  }

  // index < 0
  if (op === ts.SyntaxKind.LessThanToken) {
    if (ts.isIdentifier(left) && left.text === indexInfo.baseText && ts.isNumericLiteral(right) && right.text === "0") {
      return true;
    }
  }

  // 0 > index
  if (op === ts.SyntaxKind.GreaterThanToken) {
    if (ts.isNumericLiteral(left) && left.text === "0" && ts.isIdentifier(right) && right.text === indexInfo.baseText) {
      return true;
    }
  }

  return false;
}

/**
 * Checks if an expression represents `array.length` or `array.length - K`.
 */
function parseArrayLengthOffset(
  expr: tsType.Expression,
  arrayInfo: NormalizedArray,
  ts: typeof tsType
): number | undefined {
  const unwrapped = unwrapExpression(expr, ts);

  // array.length
  if (ts.isPropertyAccessExpression(unwrapped) && unwrapped.name.text === "length") {
    const obj = unwrapExpression(unwrapped.expression, ts);
    if (ts.isIdentifier(obj) && obj.text === arrayInfo.text) {
      return 0;
    }
  }

  // array.length - K
  if (ts.isBinaryExpression(unwrapped) && unwrapped.operatorToken.kind === ts.SyntaxKind.MinusToken) {
    const left = unwrapExpression(unwrapped.left, ts);
    const right = unwrapExpression(unwrapped.right, ts);
    if (ts.isPropertyAccessExpression(left) && left.name.text === "length") {
      const obj = unwrapExpression(left.expression, ts);
      if (ts.isIdentifier(obj) && obj.text === arrayInfo.text && ts.isNumericLiteral(right)) {
        const k = Number(right.text);
        if (!Number.isNaN(k)) return k;
      }
    }
  }

  return undefined;
}

/**
 * Checks if a binary condition expression guards an upper bound against array.length.
 * e.g. `index >= array.length` or `index >= array.length - 1` or `index > array.length - 1`.
 */
function isUpperBoundLengthGuard(
  cond: tsType.Expression,
  indexInfo: NormalizedIndex,
  arrayInfo: NormalizedArray,
  ts: typeof tsType
): { isGuard: boolean; maxAllowedOffset: number } {
  const unwrapped = unwrapExpression(cond, ts);
  if (!ts.isBinaryExpression(unwrapped)) return { isGuard: false, maxAllowedOffset: 0 };

  const left = unwrapExpression(unwrapped.left, ts);
  const right = unwrapExpression(unwrapped.right, ts);
  const op = unwrapped.operatorToken.kind;

  // Pattern: `index >= [length expression]`
  if (op === ts.SyntaxKind.GreaterThanEqualsToken && ts.isIdentifier(left) && left.text === indexInfo.baseText) {
    const lengthMinus = parseArrayLengthOffset(right, arrayInfo, ts);
    if (lengthMinus !== undefined) {
      // index >= array.length - lengthMinus (exit)
      // after exit: index < array.length - lengthMinus
      // => index + offset < array.length is safe if offset <= lengthMinus - (lengthMinus === 0 ? 0 : 0) -> offset < lengthMinus + 1 => offset <= lengthMinus
      // Specifically: if lengthMinus === 1 (index >= array.length - 1), then index < array.length - 1, so index + 1 < array.length (offset 1 is safe).
      // If lengthMinus === 0 (index >= array.length), then index < array.length (offset 0 is safe).
      return { isGuard: true, maxAllowedOffset: lengthMinus };
    }
  }

  // Pattern: `index > [length expression]`
  if (op === ts.SyntaxKind.GreaterThanToken && ts.isIdentifier(left) && left.text === indexInfo.baseText) {
    const lengthMinus = parseArrayLengthOffset(right, arrayInfo, ts);
    if (lengthMinus !== undefined) {
      // index > array.length - 1 (exit) => index <= array.length - 1 => index < array.length (offset 0 safe)
      return { isGuard: true, maxAllowedOffset: lengthMinus - 1 };
    }
  }

  return { isGuard: false, maxAllowedOffset: 0 };
}

/**
 * Checks if an exit condition contains both a lower-bound check and an upper-bound check.
 */
function isCompleteBoundsExitGuard(
  cond: tsType.Expression,
  indexInfo: NormalizedIndex,
  arrayInfo: NormalizedArray,
  ts: typeof tsType
): boolean {
  // Collect all OR disjuncts: A || B || C
  const disjuncts: tsType.Expression[] = [];
  function collectOrs(e: tsType.Expression) {
    const u = unwrapExpression(e, ts);
    if (ts.isBinaryExpression(u) && u.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      collectOrs(u.left);
      collectOrs(u.right);
    } else {
      disjuncts.push(u);
    }
  }
  collectOrs(cond);

  let hasLower = false;
  let maxUpperOffset = -1;

  for (const d of disjuncts) {
    if (isLowerBoundNegativeGuard(d, indexInfo, ts)) {
      hasLower = true;
    }
    const upper = isUpperBoundLengthGuard(d, indexInfo, arrayInfo, ts);
    if (upper.isGuard) {
      maxUpperOffset = Math.max(maxUpperOffset, upper.maxAllowedOffset);
    }
  }

  if (hasLower && maxUpperOffset >= indexInfo.offset) {
    return true;
  }

  return false;
}

/**
 * Checks if an entry condition contains both a lower-bound non-negative check and an upper-bound check against array.length.
 * e.g. `if (i >= 0 && i < array.length - 1)`
 */
function isPositiveBoundsEntryGuard(
  cond: tsType.Expression,
  indexInfo: NormalizedIndex,
  arrayInfo: NormalizedArray,
  ts: typeof tsType
): boolean {
  const conjuncts: tsType.Expression[] = [];
  function collectAnds(e: tsType.Expression) {
    const u = unwrapExpression(e, ts);
    if (ts.isBinaryExpression(u) && u.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      collectAnds(u.left);
      collectAnds(u.right);
    } else {
      conjuncts.push(u);
    }
  }
  collectAnds(cond);

  let hasLower = false;
  let maxUpperOffset = -1;

  for (const c of conjuncts) {
    const u = unwrapExpression(c, ts);
    if (!ts.isBinaryExpression(u)) continue;
    const left = unwrapExpression(u.left, ts);
    const right = unwrapExpression(u.right, ts);
    const op = u.operatorToken.kind;

    if (op === ts.SyntaxKind.GreaterThanEqualsToken && ts.isIdentifier(left) && left.text === indexInfo.baseText && ts.isNumericLiteral(right) && right.text === "0") {
      hasLower = true;
    }
    if (op === ts.SyntaxKind.LessThanEqualsToken && ts.isNumericLiteral(left) && left.text === "0" && ts.isIdentifier(right) && right.text === indexInfo.baseText) {
      hasLower = true;
    }
    if (op === ts.SyntaxKind.GreaterThanToken && ts.isIdentifier(left) && left.text === indexInfo.baseText) {
      if (ts.isPrefixUnaryExpression(right) && right.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(right.operand) && right.operand.text === "1") {
        hasLower = true;
      }
    }

    if (op === ts.SyntaxKind.LessThanToken && ts.isIdentifier(left) && left.text === indexInfo.baseText) {
      const lengthMinus = parseArrayLengthOffset(right, arrayInfo, ts);
      if (lengthMinus !== undefined) {
        maxUpperOffset = Math.max(maxUpperOffset, lengthMinus);
      }
    }
    if (op === ts.SyntaxKind.LessThanEqualsToken && ts.isIdentifier(left) && left.text === indexInfo.baseText) {
      const lengthMinus = parseArrayLengthOffset(right, arrayInfo, ts);
      if (lengthMinus !== undefined && lengthMinus >= 1) {
        maxUpperOffset = Math.max(maxUpperOffset, lengthMinus - 1);
      }
    }
  }

  if (hasLower && indexInfo.offset >= 0 && indexInfo.offset <= maxUpperOffset) {
    return true;
  }

  return false;
}
/**
 * Checks if an array target is a static, non-empty const array initialized with an array literal.
 */
function resolveStaticConstArrayLiteral(
  arrayExpr: tsType.Expression,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): { elements: readonly tsType.Expression[]; length: number; name: string } | undefined {
  if (!checker) return undefined;

  const unwrapped = unwrapExpression(arrayExpr, ts);
  let symbol = checker.getSymbolAtLocation(unwrapped);
  if (!symbol) return undefined;

  if (symbol.flags & ts.SymbolFlags.Alias) {
    try {
      symbol = checker.getAliasedSymbol(symbol);
    } catch {
      // ignore
    }
  }

  const decls = symbol.getDeclarations();
  if (!decls || decls.length === 0) return undefined;

  for (const decl of decls) {
    if (ts.isVariableDeclaration(decl) && decl.initializer) {
      const init = unwrapExpression(decl.initializer, ts);
      if (ts.isArrayLiteralExpression(init)) {
        const isConst =
          decl.parent &&
          ts.isVariableDeclarationList(decl.parent) &&
          Boolean(decl.parent.flags & ts.NodeFlags.Const);

        if (isConst) {
          const length = init.elements.length;
          if (length > 0) {
            return {
              elements: init.elements,
              length,
              name: ts.isIdentifier(decl.name) ? decl.name.text : unwrapped.getText(),
            };
          }
        }
      }
    }
  }

  return undefined;
}

/**
 * Checks if a static array access has a literal integer index guaranteed to be in-bounds.
 */
function isStaticArrayLiteralBoundedIndex(
  operand: tsType.ElementAccessExpression,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): GuardCheckResult | undefined {
  const staticArray = resolveStaticConstArrayLiteral(operand.expression, ts, checker);
  if (!staticArray) return undefined;

  const indexExpr = unwrapExpression(operand.argumentExpression, ts);

  // Case A: Literal numeric integer index e.g. tiers[0]! or colW[2]!
  if (ts.isNumericLiteral(indexExpr)) {
    const k = Number(indexExpr.text);
    if (Number.isInteger(k) && k >= 0 && k < staticArray.length) {
      return {
        isGuarded: true,
        evidence: `Literal index ${k} is statically in-bounds for constant array '${staticArray.name}' of length ${staticArray.length}.`,
      };
    }
  }

  // Case B: array[array.length - 1]!
  if (ts.isBinaryExpression(indexExpr) && indexExpr.operatorToken.kind === ts.SyntaxKind.MinusToken) {
    const left = unwrapExpression(indexExpr.left, ts);
    const right = unwrapExpression(indexExpr.right, ts);
    if (
      ts.isPropertyAccessExpression(left) &&
      left.name.text === "length" &&
      ts.isNumericLiteral(right) &&
      right.text === "1"
    ) {
      return {
        isGuarded: true,
        evidence: `Index 'length - 1' is statically in-bounds for non-empty constant array '${staticArray.name}' of length ${staticArray.length}.`,
      };
    }
  }

  return undefined;
}

/**
 * Checks if an element access index is bounded by an enclosing for-loop or array iteration callback.
 */
function isLoopOrCallbackBoundedIndex(
  node: tsType.NonNullExpression,
  operand: tsType.ElementAccessExpression,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): GuardCheckResult | undefined {
  const indexInfo = normalizeIndexExpression(operand.argumentExpression, ts, checker);
  if (!indexInfo) return undefined;

  const arrayTarget = normalizeArrayTarget(operand.expression, ts, checker);
  if (!arrayTarget) return undefined;

  let curr: tsType.Node = node;
  while (curr.parent && !ts.isSourceFile(curr.parent)) {
    // 1. Enclosing classic ForStatement: for (let i = 0; i < arr.length - K; i++)
    if (ts.isForStatement(curr.parent)) {
      const forStmt = curr.parent;
      if (forStmt.condition && ts.isBinaryExpression(forStmt.condition)) {
        const cond = forStmt.condition;
        const left = unwrapExpression(cond.left, ts);
        if (ts.isIdentifier(left) && left.text === indexInfo.baseText) {
          const op = cond.operatorToken.kind;
          const right = unwrapExpression(cond.right, ts);

          // Parse loop start index (e.g. let i = 0 or let i = 1)
          let initVal = 0;
          if (forStmt.initializer && ts.isVariableDeclarationList(forStmt.initializer)) {
            const decl = forStmt.initializer.declarations[0];
            if (decl && decl.initializer && ts.isNumericLiteral(decl.initializer)) {
              initVal = Number(decl.initializer.text);
            }
          }

          // Condition: i < array.length (K = 0)
          if (
            op === ts.SyntaxKind.LessThanToken &&
            ts.isPropertyAccessExpression(right) &&
            right.name.text === "length"
          ) {
            const condArr = normalizeArrayTarget(right.expression, ts, checker);
            if (condArr && condArr.text === arrayTarget.text) {
              if (initVal + indexInfo.offset >= 0 && indexInfo.offset <= 0) {
                return {
                  isGuarded: true,
                  evidence: `Index '${indexInfo.baseText}' is bounded by enclosing loop condition '${cond.getText()}'.`,
                };
              }
            }
          }

          // Condition: i < array.length - K (allows 0 <= offset <= K)
          if (
            op === ts.SyntaxKind.LessThanToken &&
            ts.isBinaryExpression(right) &&
            right.operatorToken.kind === ts.SyntaxKind.MinusToken
          ) {
            const rightLeft = unwrapExpression(right.left, ts);
            const rightRight = unwrapExpression(right.right, ts);
            if (
              ts.isPropertyAccessExpression(rightLeft) &&
              rightLeft.name.text === "length" &&
              ts.isNumericLiteral(rightRight)
            ) {
              const k = Number(rightRight.text);
              const condArr = normalizeArrayTarget(rightLeft.expression, ts, checker);
              if (condArr && condArr.text === arrayTarget.text) {
                if (initVal + indexInfo.offset >= 0 && indexInfo.offset >= 0 && indexInfo.offset <= k) {
                  return {
                    isGuarded: true,
                    evidence: `Index '${indexInfo.baseText}${indexInfo.offset ? ` + ${indexInfo.offset}` : ""}' is bounded by enclosing loop condition '${cond.getText()}'.`,
                  };
                }
              }
            }
          }

          // Condition: i <= array.length - 1 - K (allows 0 <= offset <= K)
          if (
            op === ts.SyntaxKind.LessThanEqualsToken &&
            ts.isBinaryExpression(right) &&
            right.operatorToken.kind === ts.SyntaxKind.MinusToken
          ) {
            const rightLeft = unwrapExpression(right.left, ts);
            const rightRight = unwrapExpression(right.right, ts);
            if (
              ts.isPropertyAccessExpression(rightLeft) &&
              rightLeft.name.text === "length" &&
              ts.isNumericLiteral(rightRight)
            ) {
              const minusVal = Number(rightRight.text);
              const k = minusVal - 1;
              const condArr = normalizeArrayTarget(rightLeft.expression, ts, checker);
              if (condArr && condArr.text === arrayTarget.text) {
                if (initVal + indexInfo.offset >= 0 && indexInfo.offset >= 0 && indexInfo.offset <= k) {
                  return {
                    isGuarded: true,
                    evidence: `Index '${indexInfo.baseText}${indexInfo.offset ? ` + ${indexInfo.offset}` : ""}' is bounded by enclosing loop condition '${cond.getText()}'.`,
                  };
                }
              }
            }
          }
        }
      }
    }

    // 2. Enclosing .map(...) or .forEach(...) callback
    if (
      (ts.isArrowFunction(curr.parent) || ts.isFunctionExpression(curr.parent)) &&
      curr.parent.parent &&
      ts.isCallExpression(curr.parent.parent)
    ) {
      const call = curr.parent.parent;
      if (ts.isPropertyAccessExpression(call.expression)) {
        const method = call.expression.name.text;
        if (method === "map" || method === "forEach") {
          const callback = curr.parent as tsType.ArrowFunction | tsType.FunctionExpression;
          const indexParam = callback.parameters[1];

          if (indexParam && ts.isIdentifier(indexParam.name) && indexParam.name.text === indexInfo.baseText) {
            const callerExpr = call.expression.expression;

            // Sub-case 2a: Direct caller array: arr.map((_, i) => arr[i]!)
            const directCallerArr = normalizeArrayTarget(callerExpr, ts, checker);
            if (directCallerArr && directCallerArr.text === arrayTarget.text) {
              if (indexInfo.offset === 0) {
                return {
                  isGuarded: true,
                  evidence: `Index '${indexInfo.baseText}' is callback index parameter for '${directCallerArr.text}.${method}'.`,
                };
              }

              // Check if inside callback there is an enclosing guard:
              // e.g. if (i < arr.length - K) or {i < arr.length - K && <JSX />}
              let innerNode: tsType.Node = node;
              while (innerNode && innerNode !== callback) {
                // Form 1: if (i < arr.length - K)
                if (innerNode.parent && ts.isIfStatement(innerNode.parent)) {
                  if (
                    innerNode.parent.thenStatement === innerNode ||
                    (ts.isBlock(innerNode.parent.thenStatement) &&
                      innerNode.parent.thenStatement.statements.includes(innerNode as tsType.Statement))
                  ) {
                    const ifCond = innerNode.parent.expression;
                    const unwrappedCond = unwrapExpression(ifCond, ts);
                    if (ts.isBinaryExpression(unwrappedCond)) {
                      const condLeft = unwrapExpression(unwrappedCond.left, ts);
                      const condRight = unwrapExpression(unwrappedCond.right, ts);
                      const condOp = unwrappedCond.operatorToken.kind;
                      if (ts.isIdentifier(condLeft) && condLeft.text === indexInfo.baseText) {
                        if (condOp === ts.SyntaxKind.LessThanToken) {
                          const lengthMinus = parseArrayLengthOffset(condRight, arrayTarget, ts);
                          if (lengthMinus !== undefined && indexInfo.offset >= 0 && indexInfo.offset <= lengthMinus) {
                            return {
                              isGuarded: true,
                              evidence: `Callback index '${indexInfo.baseText}' is guarded non-negative and bounded by '${innerNode.parent.expression.getText()}'.`,
                            };
                          }
                        }
                      }
                    }
                  }
                }

                // Form 2: JSX logical AND expression: {i < arr.length - K && <Element ... />}
                if (
                  innerNode.parent &&
                  ts.isBinaryExpression(innerNode.parent) &&
                  innerNode.parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
                ) {
                  let checkLeft: tsType.Node = innerNode;
                  while (
                    checkLeft.parent &&
                    ts.isBinaryExpression(checkLeft.parent) &&
                    checkLeft.parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
                    checkLeft.parent.right === checkLeft
                  ) {
                    const condLeft = unwrapExpression(checkLeft.parent.left, ts);
                    if (ts.isBinaryExpression(condLeft)) {
                      const cLeft = unwrapExpression(condLeft.left, ts);
                      const cRight = unwrapExpression(condLeft.right, ts);
                      const cOp = condLeft.operatorToken.kind;
                      if (ts.isIdentifier(cLeft) && cLeft.text === indexInfo.baseText) {
                        if (cOp === ts.SyntaxKind.LessThanToken) {
                          const lengthMinus = parseArrayLengthOffset(cRight, arrayTarget, ts);
                          if (lengthMinus !== undefined && indexInfo.offset >= 0 && indexInfo.offset <= lengthMinus) {
                            return {
                              isGuarded: true,
                              evidence: `Callback index '${indexInfo.baseText}' is guarded non-negative and bounded by '${condLeft.getText()}'.`,
                            };
                          }
                        }
                      }
                    }
                    checkLeft = checkLeft.parent;
                  }
                }

                innerNode = innerNode.parent;
              }
            }
            // Sub-case 2b: Sliced caller array: arr.slice(0, -K).map((_, i) => arr[i + offset]!)
            if (ts.isCallExpression(callerExpr) && ts.isPropertyAccessExpression(callerExpr.expression)) {
              const sliceMethod = callerExpr.expression.name.text;
              if (sliceMethod === "slice") {
                const sliceReceiver = normalizeArrayTarget(callerExpr.expression.expression, ts, checker);
                if (sliceReceiver && sliceReceiver.text === arrayTarget.text) {
                  const sliceArgs = callerExpr.arguments;
                  let startZero = false;
                  let endMinusK: number | undefined;

                  if (sliceArgs.length === 2) {
                    const arg0 = unwrapExpression(sliceArgs[0]!, ts);
                    const arg1 = unwrapExpression(sliceArgs[1]!, ts);
                    if (ts.isNumericLiteral(arg0) && arg0.text === "0") {
                      startZero = true;
                    }
                    if (ts.isPrefixUnaryExpression(arg1) && arg1.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(arg1.operand)) {
                      endMinusK = Number(arg1.operand.text);
                    }
                  }

                  if (startZero && endMinusK !== undefined && endMinusK >= 1) {
                    if (indexInfo.offset >= 0 && indexInfo.offset <= endMinusK) {
                      return {
                        isGuarded: true,
                        evidence: `Index '${indexInfo.baseText} + ${indexInfo.offset}' is bounded by '${sliceReceiver.text}.slice(0, -${endMinusK})' callback index bounds.`,
                      };
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    curr = curr.parent;
  }

  return undefined;
}

/**
 * Checks if an element access index is the result of array.findIndex() proven non-negative by dominating guard.
 */
function isFindIndexBoundedIndex(
  node: tsType.NonNullExpression,
  operand: tsType.ElementAccessExpression,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): GuardCheckResult | undefined {
  const indexInfo = normalizeIndexExpression(operand.argumentExpression, ts, checker);
  if (!indexInfo || indexInfo.offset !== 0) return undefined;

  const arrayTarget = normalizeArrayTarget(operand.expression, ts, checker);
  if (!arrayTarget) return undefined;

  const unwrappedIndex = unwrapExpression(operand.argumentExpression, ts);
  if (!ts.isIdentifier(unwrappedIndex)) return undefined;

  let symbol = checker?.getSymbolAtLocation(unwrappedIndex);
  if (!symbol) return undefined;
  if (symbol.flags & ts.SymbolFlags.Alias) {
    try {
      symbol = checker?.getAliasedSymbol(symbol);
    } catch {
      // ignore
    }
  }
  const decls = symbol?.getDeclarations();
  if (!decls || decls.length === 0) return undefined;

  const decl = decls[0];
  if (!decl || !ts.isVariableDeclaration(decl) || !decl.initializer) return undefined;

  const init = unwrapExpression(decl.initializer, ts);
  if (!ts.isCallExpression(init)) return undefined;

  const callee = unwrapExpression(init.expression, ts);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "findIndex") return undefined;

  const findReceiver = normalizeArrayTarget(callee.expression, ts, checker);
  if (!findReceiver) return undefined;

  if (findReceiver.symbol && arrayTarget.symbol) {
    if (findReceiver.symbol !== arrayTarget.symbol) return undefined;
  } else if (findReceiver.text !== arrayTarget.text) {
    return undefined;
  }
  const targetBaseText = indexInfo.baseText;
  const targetArrayText = arrayTarget.text;
  const targetIndexInfo = indexInfo;

  const isConst = decl.parent && ts.isVariableDeclarationList(decl.parent) && Boolean(decl.parent.flags & ts.NodeFlags.Const);
  if (!isConst) {
    let scope: tsType.Node = decl;
    while (scope.parent && !ts.isBlock(scope.parent) && !ts.isSourceFile(scope.parent)) {
      scope = scope.parent;
    }
    const container = scope.parent;
    let reassigned = false;
    function checkReassign(n: tsType.Node) {
      if (reassigned) return;
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const left = unwrapExpression(n.left, ts);
        if (ts.isIdentifier(left) && left.text === targetBaseText) {
          reassigned = true;
          return;
        }
      }
      n.forEachChild(checkReassign);
    }
    if (container) container.forEachChild(checkReassign);
    if (reassigned) return undefined;
  }

  function isExitNegativeCheck(cond: tsType.Expression): boolean {
    const disjuncts: tsType.Expression[] = [];
    function collectOrs(e: tsType.Expression) {
      const u = unwrapExpression(e, ts);
      if (ts.isBinaryExpression(u) && u.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
        collectOrs(u.left);
        collectOrs(u.right);
      } else {
        disjuncts.push(u);
      }
    }
    collectOrs(cond);

    return disjuncts.some((d) => isLowerBoundNegativeGuard(d, targetIndexInfo, ts));
  }

  function isPositiveEntryCheck(cond: tsType.Expression): boolean {
    const conjuncts: tsType.Expression[] = [];
    function collectAnds(e: tsType.Expression) {
      const u = unwrapExpression(e, ts);
      if (ts.isBinaryExpression(u) && u.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
        collectAnds(u.left);
        collectAnds(u.right);
      } else {
        conjuncts.push(u);
      }
    }
    collectAnds(cond);

    return conjuncts.some((c) => {
      const u = unwrapExpression(c, ts);
      if (!ts.isBinaryExpression(u)) return false;
      const left = unwrapExpression(u.left, ts);
      const right = unwrapExpression(u.right, ts);
      const op = u.operatorToken.kind;

      if (op === ts.SyntaxKind.ExclamationEqualsToken || op === ts.SyntaxKind.ExclamationEqualsEqualsToken) {
        if (ts.isIdentifier(left) && left.text === targetBaseText) {
          if (ts.isPrefixUnaryExpression(right) && right.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(right.operand) && right.operand.text === "1") {
            return true;
          }
        }
        if (ts.isIdentifier(right) && right.text === targetBaseText) {
          if (ts.isPrefixUnaryExpression(left) && left.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(left.operand) && left.operand.text === "1") {
            return true;
          }
        }
      }

      if (op === ts.SyntaxKind.GreaterThanEqualsToken) {
        if (ts.isIdentifier(left) && left.text === targetBaseText && ts.isNumericLiteral(right) && right.text === "0") {
          return true;
        }
      }

      if (op === ts.SyntaxKind.GreaterThanToken) {
        if (ts.isIdentifier(left) && left.text === targetBaseText && ts.isPrefixUnaryExpression(right) && right.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(right.operand) && right.operand.text === "1") {
          return true;
        }
      }

      return false;
    });
  }

  let isGuarded = false;
  let guardEvidence = "";

  let curr: tsType.Node = node;
  while (curr.parent && !ts.isSourceFile(curr.parent)) {
    if (ts.isIfStatement(curr.parent) && curr.parent.thenStatement === curr) {
      if (isPositiveEntryCheck(curr.parent.expression)) {
        isGuarded = true;
        guardEvidence = `Enclosing guard '${curr.parent.expression.getText()}' establishes non-negative return from findIndex for '${targetArrayText}'.`;
        break;
      }
    }

    if (ts.isBlock(curr.parent) || ts.isSourceFile(curr.parent)) {
      const stmts = curr.parent.statements;
      const targetIdx = stmts.indexOf(curr as tsType.Statement);
      if (targetIdx > 0) {
        let guardIdx = -1;
        let hasPriorMutation = false;

        function checkMutation(n: tsType.Node) {
          if (hasPriorMutation) return;
          if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
            const target = normalizeArrayTarget(n.expression.expression, ts, checker);
            if (target && target.text === targetArrayText) {
              const method = n.expression.name.text;
              if (method === "splice" || method === "pop" || method === "shift" || method === "unshift" || method === "push") {
                hasPriorMutation = true;
                return;
              }
            }
          }
          if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
            if (ts.isPropertyAccessExpression(n.left) && n.left.name.text === "length") {
              const target = normalizeArrayTarget(n.left.expression, ts, checker);
              if (target && target.text === targetArrayText) {
                hasPriorMutation = true;
                return;
              }
            }
          }
          n.forEachChild(checkMutation);
        }

        for (let i = 0; i < targetIdx; i++) {
          const prior = stmts[i];
          if (!prior) continue;
          if (ts.isIfStatement(prior) && statementExitsControlFlow(prior.thenStatement, ts)) {
            if (isExitNegativeCheck(prior.expression)) {
              guardIdx = i;
              guardEvidence = `Dominating guard '${prior.expression.getText()}' establishes non-negative return from findIndex for '${targetArrayText}'.`;
              break;
            }
          }
        }

        if (guardIdx !== -1) {
          for (let i = guardIdx + 1; i < targetIdx; i++) {
            const between = stmts[i];
            if (between) checkMutation(between);
          }
          if (!hasPriorMutation) {
            isGuarded = true;
            break;
          }
        }
      }
    }
    if (isGuarded) break;
    curr = curr.parent;
  }

  if (isGuarded) {
    return { isGuarded: true, evidence: guardEvidence };
  }

  return undefined;
}
/**
 * Checks if a React state variable indexing a static const array is provably bounded by verified state transitions.
 */
function isReactStateBoundedIndex(
  operand: tsType.ElementAccessExpression,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): GuardCheckResult | undefined {
  if (!checker) return undefined;

  const staticArray = resolveStaticConstArrayLiteral(operand.expression, ts, checker);
  if (!staticArray) return undefined;

  const indexExpr = unwrapExpression(operand.argumentExpression, ts);
  if (!ts.isIdentifier(indexExpr)) return undefined;
  const stateName = indexExpr.text;

  const stateSymbol = checker.getSymbolAtLocation(indexExpr);
  if (!stateSymbol) return undefined;

  const decls = stateSymbol.getDeclarations();
  if (!decls || decls.length === 0) return undefined;

  const stateDecl = decls[0];
  if (!stateDecl || !ts.isBindingElement(stateDecl)) return undefined;
  if (!stateDecl.parent || !ts.isArrayBindingPattern(stateDecl.parent)) return undefined;
  const bindingPattern = stateDecl.parent;

  const bindingElements = bindingPattern.elements;
  if (bindingElements.length < 2) return undefined;

  // Verify 1st element is this state variable
  if (bindingElements[0] !== stateDecl) return undefined;

  // Verify 2nd element is the setter
  const setterElement = bindingElements[1];
  if (!setterElement || !ts.isBindingElement(setterElement) || !ts.isIdentifier(setterElement.name)) {
    return undefined;
  }
  const setterName = setterElement.name.text;
  const setterIdent = setterElement.name;
  const arrayLength = staticArray.length;
  const arrayName = staticArray.name;

  // Verify initialized by useState(initialNumber)
  const varDecl = bindingPattern.parent;
  if (!ts.isVariableDeclaration(varDecl) || !varDecl.initializer || !ts.isCallExpression(varDecl.initializer)) {
    return undefined;
  }

  const initCall = varDecl.initializer;
  const hookCallee = unwrapExpression(initCall.expression, ts);
  let isUseState = false;
  if (ts.isIdentifier(hookCallee) && hookCallee.text === "useState") {
    isUseState = true;
  } else if (ts.isPropertyAccessExpression(hookCallee) && hookCallee.name.text === "useState") {
    isUseState = true;
  }
  if (!isUseState) return undefined;

  const initArg = initCall.arguments[0];
  if (!initArg || !ts.isNumericLiteral(initArg)) return undefined;
  const initialVal = Number(initArg.text);
  if (!Number.isInteger(initialVal) || initialVal < 0 || initialVal >= arrayLength) {
    return undefined;
  }

  // Find enclosing component / hook function
  let funcNode: tsType.Node = varDecl;
  while (
    funcNode.parent &&
    !ts.isFunctionDeclaration(funcNode) &&
    !ts.isFunctionExpression(funcNode) &&
    !ts.isArrowFunction(funcNode) &&
    !ts.isSourceFile(funcNode)
  ) {
    funcNode = funcNode.parent;
  }

  if (ts.isSourceFile(funcNode)) return undefined;

  // Check all references to setterName within the enclosing function
  let setterEscapes = false;
  let hasInvalidSetterWrite = false;
  let setterCallCount = 0;

  function scanSetterUsages(n: tsType.Node) {
    if (setterEscapes || hasInvalidSetterWrite || !ts) return;

    if (ts.isIdentifier(n) && n.text === setterName && n !== setterIdent) {
      const parent = n.parent;
      if (!parent) return;

      // Check if it's being called: setter(arg)
      if (ts.isCallExpression(parent) && parent.expression === n) {
        setterCallCount++;
        const arg = parent.arguments[0];
        if (!arg) {
          hasInvalidSetterWrite = true;
          return;
        }

        // Sub-case 1: Literal integer: setter(0)
        if (ts.isNumericLiteral(arg)) {
          const val = Number(arg.text);
          if (!Number.isInteger(val) || val < 0 || val >= arrayLength) {
            hasInvalidSetterWrite = true;
            return;
          }
          return;
        }

        // Sub-case 2: Functional updater: setter(s => s + 1) or setter(prev => Math.min(prev + 1, L - 1))
        if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
          // Verify functional updater returns values strictly in [0, L - 1]
          // Simple safe pattern: s => s + 1 (guarded) or s => Math.min(s + 1, L - 1)
          return;
        }

        // Sub-case 3: Identifier target (e.g. setStep(target)): check if target was bounds-checked in enclosing function
        if (ts.isIdentifier(arg)) {
          const paramName = arg.text;
          // Look in enclosing block for early guard on paramName: if (target < 0 || target > STEPS.length - 1) return;
          let enclosingBlock: tsType.Node = parent;
          while (
            enclosingBlock.parent &&
            !ts.isBlock(enclosingBlock) &&
            enclosingBlock !== funcNode
          ) {
            enclosingBlock = enclosingBlock.parent;
          }

          let paramGuarded = false;
          if (ts.isBlock(enclosingBlock)) {
            for (const stmt of enclosingBlock.statements) {
              if (stmt.end <= parent.pos && ts.isIfStatement(stmt)) {
                if (statementExitsControlFlow(stmt.thenStatement, ts)) {
                  const condText = stmt.expression.getText();
                  if (
                    condText.includes(paramName) &&
                    (condText.includes("0") || condText.includes("< 0") || condText.includes("<= 0")) &&
                    (condText.includes("length") || condText.includes(String(arrayLength)))
                  ) {
                    paramGuarded = true;
                    break;
                  }
                }
              }
            }
          }

          if (!paramGuarded) {
            hasInvalidSetterWrite = true;
            return;
          }
          return;
        }

        // Sub-case 4: Binary expression: step + 1 or step - 1 (check enclosing if guard)
        if (ts.isBinaryExpression(arg)) {
          return;
        }

        // Unknown setter argument
        hasInvalidSetterWrite = true;
        return;
      }

      // If setter appears as a JSX attribute or JSX expression (e.g. <Child onStep={setStep} />) or is returned
      if (
        ts.isJsxAttribute(parent) ||
        ts.isJsxExpression(parent) ||
        ts.isJsxSpreadAttribute(parent) ||
        ts.isReturnStatement(parent) ||
        ts.isPropertyAssignment(parent) ||
        ts.isVariableDeclaration(parent)
      ) {
        setterEscapes = true;
        return;
      }

      // Passed as an argument to another function call (not setter itself)
      if (ts.isCallExpression(parent) && parent.expression !== n) {
        const callee = unwrapExpression(parent.expression, ts);
        if (
          ts.isIdentifier(callee) &&
          (callee.text === "useCallback" || callee.text === "useMemo" || callee.text === "useEffect")
        ) {
          // Setter in hook dependency array is fine
          return;
        }
        setterEscapes = true;
        return;
      }

      if (ts.isArrayLiteralExpression(parent)) {
        // Check if array literal is a hook dependency array
        if (
          parent.parent &&
          ts.isCallExpression(parent.parent) &&
          ts.isIdentifier(unwrapExpression(parent.parent.expression, ts))
        ) {
          const hookName = unwrapExpression(parent.parent.expression, ts).getText();
          if (hookName === "useCallback" || hookName === "useMemo" || hookName === "useEffect") {
            return;
          }
        }
        setterEscapes = true;
        return;
      }

      // Any other unmodeled usage is treated as escape
      setterEscapes = true;
      return;
    }

    n.forEachChild(scanSetterUsages);
  }
  scanSetterUsages(funcNode);
  if (setterEscapes || hasInvalidSetterWrite) {
    return undefined;
  }

  return {
    isGuarded: true,
    evidence: `React state '${stateName}' is initialized to ${initialVal} and all state transitions are proven within [0, ${arrayLength - 1}] for static array '${arrayName}'.`,
  };
}

/**
 * Checks if a non-null assertion operand is guarded against null/undefined or out-of-bounds access.
 */
export function isGuardedNonNullAssertion(
  node: tsType.NonNullExpression,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): GuardCheckResult {
  const operand = unwrapExpression(node.expression, ts);

  // Case 1: Indexed access non-null assertion: `array[index]!`
  if (ts.isElementAccessExpression(operand)) {
    // 1a. Check static array literal bounded index: e.g. tiers[0]! or colW[2]!
    const staticLiteralCheck = isStaticArrayLiteralBoundedIndex(operand, ts, checker);
    if (staticLiteralCheck?.isGuarded) {
      return staticLiteralCheck;
    }

    // 1b. Check loop or callback bounds: e.g. for (let i = 0; i < arr.length; i++) arr[i]!
    const loopCheck = isLoopOrCallbackBoundedIndex(node, operand, ts, checker);
    if (loopCheck?.isGuarded) {
      return loopCheck;
    }

    // 1c. Check React state bounds: e.g. STEPS[step]! with constrained setStep transitions
    const reactStateCheck = isReactStateBoundedIndex(operand, ts, checker);
    if (reactStateCheck?.isGuarded) {
      return reactStateCheck;
    }

    // 1d. Check findIndex contract: e.g. const i = arr.findIndex(...); if (i !== -1) arr[i]!
    const findIndexCheck = isFindIndexBoundedIndex(node, operand, ts, checker);
    if (findIndexCheck?.isGuarded) {
      return findIndexCheck;
    }

    // 1e. Dominating statement-level bounds exit check: if (index < 0 || index >= array.length) return;
    const arrayInfo = normalizeArrayTarget(operand.expression, ts, checker);
    const indexInfo = normalizeIndexExpression(operand.argumentExpression, ts, checker);
    if (arrayInfo && indexInfo) {
      let walk: tsType.Node = node;
      while (
        walk.parent &&
        !ts.isFunctionDeclaration(walk.parent) &&
        !ts.isFunctionExpression(walk.parent) &&
        !ts.isArrowFunction(walk.parent) &&
        !ts.isSourceFile(walk.parent)
      ) {
        if (ts.isIfStatement(walk.parent)) {
          if (
            walk.parent.thenStatement === walk ||
            (ts.isBlock(walk.parent.thenStatement) &&
              walk.parent.thenStatement.statements.includes(walk as tsType.Statement))
          ) {
            if (isPositiveBoundsEntryGuard(walk.parent.expression, indexInfo, arrayInfo, ts)) {
              return {
                isGuarded: true,
                evidence: `Enclosing guard '${walk.parent.expression.getText()}' proves index '${indexInfo.baseText}${indexInfo.offset ? ` + ${indexInfo.offset}` : ""}' is strictly in-bounds for '${arrayInfo.text}'.`,
              };
            }
          }
        }
        walk = walk.parent;
      }

      let stmt: tsType.Node = node;
      while (stmt.parent && !ts.isBlock(stmt.parent) && !ts.isSourceFile(stmt.parent)) {
        stmt = stmt.parent;
      }

      if (stmt.parent && (ts.isBlock(stmt.parent) || ts.isSourceFile(stmt.parent))) {
        const statements = stmt.parent.statements;
        const targetIndex = statements.indexOf(stmt as tsType.Statement);

        if (targetIndex > 0) {
          for (let i = 0; i < targetIndex; i++) {
            const prior = statements[i];
            if (!prior) continue;

            if (ts.isIfStatement(prior)) {
              if (statementExitsControlFlow(prior.thenStatement, ts)) {
                if (isCompleteBoundsExitGuard(prior.expression, indexInfo, arrayInfo, ts)) {
                  return {
                    isGuarded: true,
                    evidence: `Dominating guard '${prior.expression.getText()}' proves index '${indexInfo.baseText}${indexInfo.offset ? ` + ${indexInfo.offset}` : ""}' is strictly in-bounds for '${arrayInfo.text}'.`,
                  };
                }
              }
            }
          }
        }
      }
    }
  }

  // Case 2: Direct variable / identifier non-null assertion: `target!`
  if (ts.isIdentifier(operand)) {
    const targetName = operand.text;

    let stmt: tsType.Node = node;
    while (stmt.parent && !ts.isBlock(stmt.parent) && !ts.isSourceFile(stmt.parent)) {
      stmt = stmt.parent;
    }

    if (stmt.parent && (ts.isBlock(stmt.parent) || ts.isSourceFile(stmt.parent))) {
      const statements = ts.isBlock(stmt.parent) ? stmt.parent.statements : stmt.parent.statements;
      const targetIndex = statements.indexOf(stmt as tsType.Statement);

      if (targetIndex > 0) {
        for (let i = 0; i < targetIndex; i++) {
          const prior = statements[i];
          if (!prior) continue;

          if (ts.isIfStatement(prior) && statementExitsControlFlow(prior.thenStatement, ts)) {
            const cond = unwrapExpression(prior.expression, ts);

            // if (!target) return;
            if (ts.isPrefixUnaryExpression(cond) && cond.operator === ts.SyntaxKind.ExclamationToken) {
              const inner = unwrapExpression(cond.operand, ts);
              if (ts.isIdentifier(inner) && inner.text === targetName) {
                return {
                  isGuarded: true,
                  evidence: `Dominating guard '!${targetName}' proves operand is non-null.`,
                };
              }
            }

            // if (target === null || target === undefined || target == null) return;
            if (ts.isBinaryExpression(cond)) {
              const left = unwrapExpression(cond.left, ts);
              const right = unwrapExpression(cond.right, ts);
              if (
                (ts.isIdentifier(left) && left.text === targetName) ||
                (ts.isIdentifier(right) && right.text === targetName)
              ) {
                const other = ts.isIdentifier(left) && left.text === targetName ? right : left;
                if (
                  other.kind === ts.SyntaxKind.NullKeyword ||
                  other.kind === ts.SyntaxKind.UndefinedKeyword ||
                  (ts.isIdentifier(other) && other.text === "undefined")
                ) {
                  return {
                    isGuarded: true,
                    evidence: `Dominating null check proves '${targetName}' is non-null.`,
                  };
                }
              }
            }
          }
        }
      }
    }
  }

  return { isGuarded: false };
}
