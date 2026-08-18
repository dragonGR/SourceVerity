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
    const arrayInfo = normalizeArrayTarget(operand.expression, ts, checker);
    const indexInfo = normalizeIndexExpression(operand.argumentExpression, ts, checker);

    if (arrayInfo && indexInfo) {
      // Find enclosing block / function containing the statement of this node
      let stmt: tsType.Node = node;
      while (stmt.parent && !ts.isBlock(stmt.parent) && !ts.isSourceFile(stmt.parent)) {
        stmt = stmt.parent;
      }

      if (stmt.parent && (ts.isBlock(stmt.parent) || ts.isSourceFile(stmt.parent))) {
        const statements = ts.isBlock(stmt.parent) ? stmt.parent.statements : stmt.parent.statements;
        const targetIndex = statements.indexOf(stmt as tsType.Statement);

        if (targetIndex > 0) {
          // Look at prior sibling statements
          for (let i = 0; i < targetIndex; i++) {
            const prior = statements[i];
            if (!prior) continue;

            // Look for early-exit if guard: if (index === -1 || index >= array.length - 1) return null;
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
