import type * as tsType from "typescript";
import { unwrapExpression } from "./values.js";
import { resolveReactHook } from "../engine/symbols.js";

export interface GuardCheckResult {
  readonly isGuarded: boolean;
  readonly evidence?: string | undefined;
}

/**
 * Checks if a statement definitely exits control flow (return, throw, break, continue).
 */
export function statementExitsControlFlow(stmt: tsType.Statement, ts: typeof tsType): boolean {
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

function isAssignmentOperator(kind: tsType.SyntaxKind, ts: typeof tsType): boolean {
  return (
    kind === ts.SyntaxKind.EqualsToken ||
    kind === ts.SyntaxKind.PlusEqualsToken ||
    kind === ts.SyntaxKind.MinusEqualsToken ||
    kind === ts.SyntaxKind.AsteriskEqualsToken ||
    kind === ts.SyntaxKind.AsteriskAsteriskEqualsToken ||
    kind === ts.SyntaxKind.SlashEqualsToken ||
    kind === ts.SyntaxKind.PercentEqualsToken ||
    kind === ts.SyntaxKind.LessThanLessThanEqualsToken ||
    kind === ts.SyntaxKind.GreaterThanGreaterThanEqualsToken ||
    kind === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken ||
    kind === ts.SyntaxKind.AmpersandEqualsToken ||
    kind === ts.SyntaxKind.BarEqualsToken ||
    kind === ts.SyntaxKind.CaretEqualsToken ||
    kind === ts.SyntaxKind.BarBarEqualsToken ||
    kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken ||
    kind === ts.SyntaxKind.QuestionQuestionEqualsToken
  );
}

export function hasVariableReassignment(
  node: tsType.Node,
  targetName: string,
  targetSymbol: tsType.Symbol | undefined,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined,
  beforePos?: number,
  afterPos?: number
): boolean {
  let reassigned = false;

  function checkTargetMatch(ident: tsType.Identifier): boolean {
    if (checker && targetSymbol) {
      let sym = checker.getSymbolAtLocation(ident);
      if (sym && (sym.flags & ts.SymbolFlags.Alias) !== 0) {
        try {
          sym = checker.getAliasedSymbol(sym);
        } catch {
          // ignore
        }
      }
      if (sym) {
        return sym === targetSymbol;
      }
    }
    return targetSymbol === undefined && ident.text === targetName;
  }

  function checkLeftAssignment(leftExpr: tsType.Expression): boolean {
    const unwrapped = unwrapExpression(leftExpr, ts);
    if (ts.isIdentifier(unwrapped)) {
      return checkTargetMatch(unwrapped);
    }
    if (ts.isArrayLiteralExpression(unwrapped)) {
      return unwrapped.elements.some((el) => {
        if (ts.isOmittedExpression(el)) return false;
        if (ts.isSpreadElement(el)) {
          return checkLeftAssignment(el.expression);
        }
        return checkLeftAssignment(el);
      });
    }
    if (ts.isObjectLiteralExpression(unwrapped)) {
      return unwrapped.properties.some((prop) => {
        if (ts.isShorthandPropertyAssignment(prop)) {
          return checkTargetMatch(prop.name);
        }
        if (ts.isPropertyAssignment(prop) && ts.isExpression(prop.initializer)) {
          return checkLeftAssignment(prop.initializer);
        }
        if (ts.isSpreadAssignment(prop)) {
          return checkLeftAssignment(prop.expression);
        }
        return false;
      });
    }
    return false;
  }

  function walk(n: tsType.Node) {
    if (reassigned) return;
    const nStart = n.getStart();
    const nEnd = n.getEnd();
    if (beforePos !== undefined && nStart > beforePos) return;
    if (afterPos !== undefined && nEnd < afterPos) return;

    const inRange = (afterPos === undefined || nStart >= afterPos) && (beforePos === undefined || nStart <= beforePos);

    if (inRange && ts.isBinaryExpression(n) && isAssignmentOperator(n.operatorToken.kind, ts)) {
      if (checkLeftAssignment(n.left)) {
        reassigned = true;
        return;
      }
    }

    if (
      inRange &&
      (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) &&
      (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      const operand = unwrapExpression(n.operand, ts);
      if (ts.isIdentifier(operand) && checkTargetMatch(operand)) {
        reassigned = true;
        return;
      }
    }

    n.forEachChild(walk);
  }

  walk(node);
  return reassigned;
}

function isStateUpperBoundGuard(
  cond: tsType.Expression,
  stateName: string,
  maxExclusive: number,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): boolean {
  const unwrapped = unwrapExpression(cond, ts);
  if (ts.isBinaryExpression(unwrapped)) {
    const op = unwrapped.operatorToken.kind;
    const left = unwrapExpression(unwrapped.left, ts);
    const right = unwrapExpression(unwrapped.right, ts);

    if (ts.isIdentifier(left) && left.text === stateName) {
      if (ts.isNumericLiteral(right)) {
        const limit = Number(right.text);
        if (op === ts.SyntaxKind.LessThanToken && limit <= maxExclusive) return true;
        if (op === ts.SyntaxKind.LessThanEqualsToken && limit <= maxExclusive - 1) return true;
      }
      if (ts.isBinaryExpression(right) && right.operatorToken.kind === ts.SyntaxKind.MinusToken) {
        const rLeft = unwrapExpression(right.left, ts);
        const rRight = unwrapExpression(right.right, ts);
        if (ts.isPropertyAccessExpression(rLeft) && rLeft.name.text === "length" && ts.isNumericLiteral(rRight)) {
          const minusNum = Number(rRight.text);
          if (op === ts.SyntaxKind.LessThanToken && minusNum >= 1) return true;
          if (op === ts.SyntaxKind.LessThanEqualsToken && minusNum >= 2) return true;
        }
      }
    }
  }
  return false;
}

function isStateLowerBoundGuard(
  cond: tsType.Expression,
  stateName: string,
  minInclusive: number,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): boolean {
  const unwrapped = unwrapExpression(cond, ts);
  if (ts.isBinaryExpression(unwrapped)) {
    const op = unwrapped.operatorToken.kind;
    const left = unwrapExpression(unwrapped.left, ts);
    const right = unwrapExpression(unwrapped.right, ts);

    if (ts.isIdentifier(left) && left.text === stateName) {
      if (ts.isNumericLiteral(right)) {
        const limit = Number(right.text);
        if (op === ts.SyntaxKind.GreaterThanToken && limit >= minInclusive - 1) return true;
        if (op === ts.SyntaxKind.GreaterThanEqualsToken && limit >= minInclusive) return true;
      }
    }
  }
  return false;
}

function isParamBoundedCondition(
  cond: tsType.Expression,
  paramName: string,
  arrayLength: number,
  ts: typeof tsType,
  isExitGuard: boolean
): boolean {
  const unwrapped = unwrapExpression(cond, ts);

  if (isExitGuard) {
    // Exit guard disjunction: param < 0 || param >= arrayLength (or param > arrayLength - 1)
    if (ts.isBinaryExpression(unwrapped) && unwrapped.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      let hasLowerExit = false;
      let hasUpperExit = false;
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
      collectOrs(unwrapped);

      for (const d of disjuncts) {
        if (ts.isBinaryExpression(d)) {
          const op = d.operatorToken.kind;
          const left = unwrapExpression(d.left, ts);
          const right = unwrapExpression(d.right, ts);
          if (ts.isIdentifier(left) && left.text === paramName) {
            if (ts.isNumericLiteral(right)) {
              const n = Number(right.text);
              if ((op === ts.SyntaxKind.LessThanToken && n === 0) || (op === ts.SyntaxKind.LessThanEqualsToken && n === -1)) {
                hasLowerExit = true;
              }
              if ((op === ts.SyntaxKind.GreaterThanEqualsToken && n >= arrayLength) || (op === ts.SyntaxKind.GreaterThanToken && n >= arrayLength - 1)) {
                hasUpperExit = true;
              }
            }
            if (ts.isPropertyAccessExpression(right) && right.name.text === "length") {
              if (op === ts.SyntaxKind.GreaterThanEqualsToken || op === ts.SyntaxKind.GreaterThanToken) {
                hasUpperExit = true;
              }
            }
            if (ts.isBinaryExpression(right) && right.operatorToken.kind === ts.SyntaxKind.MinusToken) {
              const rLeft = unwrapExpression(right.left, ts);
              if (ts.isPropertyAccessExpression(rLeft) && rLeft.name.text === "length") {
                if (op === ts.SyntaxKind.GreaterThanToken) {
                  hasUpperExit = true;
                }
              }
            }
          }
        }
      }
      return hasLowerExit && hasUpperExit;
    }
  } else {
    // Entry guard conjunction: param >= 0 && param < arrayLength
    if (ts.isBinaryExpression(unwrapped) && unwrapped.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      let hasLowerEntry = false;
      let hasUpperEntry = false;
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
      collectAnds(unwrapped);

      for (const c of conjuncts) {
        if (ts.isBinaryExpression(c)) {
          const op = c.operatorToken.kind;
          const left = unwrapExpression(c.left, ts);
          const right = unwrapExpression(c.right, ts);
          if (ts.isIdentifier(left) && left.text === paramName) {
            if (ts.isNumericLiteral(right)) {
              const n = Number(right.text);
              if ((op === ts.SyntaxKind.GreaterThanEqualsToken && n === 0) || (op === ts.SyntaxKind.GreaterThanToken && n === -1)) {
                hasLowerEntry = true;
              }
              if ((op === ts.SyntaxKind.LessThanToken && n <= arrayLength) || (op === ts.SyntaxKind.LessThanEqualsToken && n <= arrayLength - 1)) {
                hasUpperEntry = true;
              }
            }
            if (ts.isPropertyAccessExpression(right) && right.name.text === "length") {
              if (op === ts.SyntaxKind.LessThanToken || op === ts.SyntaxKind.LessThanEqualsToken) {
                hasUpperEntry = true;
              }
            }
          }
        }
      }
      return hasLowerEntry && hasUpperEntry;
    }
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

function arraysMatch(
  a: NormalizedArray | undefined,
  b: NormalizedArray | undefined
): boolean {
  if (!a || !b) return false;
  if (a.symbol && b.symbol && a.symbol === b.symbol) return true;
  return a.text === b.text;
}

function isNodeDescendantOf(child: tsType.Node, parent: tsType.Node): boolean {
  let cur: tsType.Node | undefined = child;
  while (cur) {
    if (cur === parent) return true;
    cur = cur.parent;
  }
  return false;
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
  arrayInfo: NormalizedArray | readonly NormalizedArray[],
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): number | undefined {
  const unwrapped = unwrapExpression(expr, ts);
  const targets = Array.isArray(arrayInfo) ? arrayInfo : [arrayInfo];

  // array.length
  if (ts.isPropertyAccessExpression(unwrapped) && unwrapped.name.text === "length") {
    const objTarget = normalizeArrayTarget(unwrapped.expression, ts, checker);
    if (objTarget && targets.some((t) => arraysMatch(objTarget, t))) {
      return 0;
    }
  }

  // array.length - K
  if (ts.isBinaryExpression(unwrapped) && unwrapped.operatorToken.kind === ts.SyntaxKind.MinusToken) {
    const left = unwrapExpression(unwrapped.left, ts);
    const right = unwrapExpression(unwrapped.right, ts);
    if (ts.isPropertyAccessExpression(left) && left.name.text === "length") {
      const objTarget = normalizeArrayTarget(left.expression, ts, checker);
      if (objTarget && targets.some((t) => arraysMatch(objTarget, t)) && ts.isNumericLiteral(right)) {
        const k = Number(right.text);
        if (!Number.isNaN(k)) return k;
      }
    }
  }

  return undefined;
}

function parseLengthPropertyTarget(
  expr: tsType.Expression,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): NormalizedArray | undefined {
  const unwrapped = unwrapExpression(expr, ts);
  if (ts.isPropertyAccessExpression(unwrapped) && unwrapped.name.text === "length") {
    return normalizeArrayTarget(unwrapped.expression, ts, checker);
  }
  return undefined;
}

interface GuardedLengthFact {
  readonly minLength: number;
  readonly exactLength?: number | undefined;
}

function parseGuardedLengthCondition(
  expr: tsType.Expression,
  arrayTarget: NormalizedArray,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): GuardedLengthFact | undefined {
  const unwrapped = unwrapExpression(expr, ts);

  if (ts.isBinaryExpression(unwrapped)) {
    const op = unwrapped.operatorToken.kind;
    const left = unwrapExpression(unwrapped.left, ts);
    const right = unwrapExpression(unwrapped.right, ts);

    // Conjunction: A && B
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
      const leftFact = parseGuardedLengthCondition(unwrapped.left, arrayTarget, ts, checker);
      const rightFact = parseGuardedLengthCondition(unwrapped.right, arrayTarget, ts, checker);
      if (leftFact && rightFact) {
        return {
          minLength: Math.max(leftFact.minLength, rightFact.minLength),
          exactLength: leftFact.exactLength ?? rightFact.exactLength,
        };
      }
      return leftFact ?? rightFact;
    }

    const leftTarget = parseLengthPropertyTarget(left, ts, checker);
    const rightTarget = parseLengthPropertyTarget(right, ts, checker);

    // Left is arr.length, right is number literal
    if (arraysMatch(leftTarget, arrayTarget) && ts.isNumericLiteral(right)) {
      const num = Number(right.text);
      if (Number.isInteger(num) && num >= 0) {
        if (op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken) {
          return { minLength: num, exactLength: num };
        }
        if (op === ts.SyntaxKind.GreaterThanEqualsToken) {
          return { minLength: num };
        }
        if (op === ts.SyntaxKind.GreaterThanToken) {
          return { minLength: num + 1 };
        }
      }
    }

    // Right is arr.length, left is number literal
    if (arraysMatch(rightTarget, arrayTarget) && ts.isNumericLiteral(left)) {
      const num = Number(left.text);
      if (Number.isInteger(num) && num >= 0) {
        if (op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken) {
          return { minLength: num, exactLength: num };
        }
        if (op === ts.SyntaxKind.LessThanEqualsToken) {
          return { minLength: num };
        }
        if (op === ts.SyntaxKind.LessThanToken) {
          return { minLength: num + 1 };
        }
      }
    }
  }

  return undefined;
}

function parseExitGuardedLengthCondition(
  expr: tsType.Expression,
  arrayTarget: NormalizedArray,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): GuardedLengthFact | undefined {
  const unwrapped = unwrapExpression(expr, ts);

  // Disjunction: A || B
  if (ts.isBinaryExpression(unwrapped) && unwrapped.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    const leftFact = parseExitGuardedLengthCondition(unwrapped.left, arrayTarget, ts, checker);
    const rightFact = parseExitGuardedLengthCondition(unwrapped.right, arrayTarget, ts, checker);
    if (leftFact && rightFact) {
      return {
        minLength: Math.max(leftFact.minLength, rightFact.minLength),
        exactLength: leftFact.exactLength ?? rightFact.exactLength,
      };
    }
    return leftFact ?? rightFact;
  }

  // !arr.length or !arr
  if (ts.isPrefixUnaryExpression(unwrapped) && unwrapped.operator === ts.SyntaxKind.ExclamationToken) {
    const inner = unwrapExpression(unwrapped.operand, ts);
    const target = parseLengthPropertyTarget(inner, ts, checker);
    if (arraysMatch(target, arrayTarget)) {
      return { minLength: 1 };
    }
  }

  if (ts.isBinaryExpression(unwrapped)) {
    const op = unwrapped.operatorToken.kind;
    const left = unwrapExpression(unwrapped.left, ts);
    const right = unwrapExpression(unwrapped.right, ts);

    const leftTarget = parseLengthPropertyTarget(left, ts, checker);
    const rightTarget = parseLengthPropertyTarget(right, ts, checker);

    // Left is arr.length, right is number
    if (arraysMatch(leftTarget, arrayTarget) && ts.isNumericLiteral(right)) {
      const num = Number(right.text);
      if (Number.isInteger(num) && num >= 0) {
        if (op === ts.SyntaxKind.ExclamationEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken) {
          return { minLength: num, exactLength: num };
        }
        if (op === ts.SyntaxKind.LessThanToken) {
          return { minLength: num };
        }
        if (op === ts.SyntaxKind.LessThanEqualsToken) {
          return { minLength: num + 1 };
        }
        if ((op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken) && num === 0) {
          return { minLength: 1 };
        }
      }
    }

    // Right is arr.length, left is number
    if (arraysMatch(rightTarget, arrayTarget) && ts.isNumericLiteral(left)) {
      const num = Number(left.text);
      if (Number.isInteger(num) && num >= 0) {
        if (op === ts.SyntaxKind.ExclamationEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken) {
          return { minLength: num, exactLength: num };
        }
        if (op === ts.SyntaxKind.GreaterThanToken) {
          return { minLength: num };
        }
        if (op === ts.SyntaxKind.GreaterThanEqualsToken) {
          return { minLength: num + 1 };
        }
        if ((op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken) && num === 0) {
          return { minLength: 1 };
        }
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
 * Checks if a literal index access is proven in-bounds by a dominating fixed-length equality or comparison guard.
 * e.g. `if (arr.length === 2) arr[0]!` or `if (arr.length >= 2) arr[1]!`
 */
function isFixedLengthGuardedIndex(
  node: tsType.NonNullExpression,
  operand: tsType.ElementAccessExpression,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): GuardCheckResult | undefined {
  const arrayTarget = normalizeArrayTarget(operand.expression, ts, checker);
  if (!arrayTarget) return undefined;

  const indexExpr = unwrapExpression(operand.argumentExpression, ts);
  if (!ts.isNumericLiteral(indexExpr)) return undefined;

  const k = Number(indexExpr.text);
  if (!Number.isInteger(k) || k < 0) return undefined;

  // 1. Walk up enclosing AST nodes (if statements, && expressions, ternary expressions)
  let curr: tsType.Node = node;
  while (
    curr.parent &&
    !ts.isFunctionDeclaration(curr.parent) &&
    !ts.isFunctionExpression(curr.parent) &&
    !ts.isArrowFunction(curr.parent) &&
    !ts.isSourceFile(curr.parent)
  ) {
    // Case A: Enclosing IfStatement
    if (ts.isIfStatement(curr.parent)) {
      const ifStmt = curr.parent;
      if (
        ifStmt.thenStatement === curr ||
        (ts.isBlock(ifStmt.thenStatement) && ifStmt.thenStatement.statements.includes(curr as tsType.Statement)) ||
        isNodeDescendantOf(curr, ifStmt.thenStatement)
      ) {
        const fact = parseGuardedLengthCondition(ifStmt.expression, arrayTarget, ts, checker);
        if (fact) {
          const maxAllowed = fact.exactLength ?? fact.minLength;
          if (k < maxAllowed) {
            if (!hasMutationBeforeNode(ifStmt.thenStatement, node, arrayTarget.text, ts, checker, arrayTarget.symbol)) {
              return {
                isGuarded: true,
                evidence: `Enclosing guard '${ifStmt.expression.getText()}' proves '${arrayTarget.text}' has length ${fact.exactLength !== undefined ? `=== ${fact.exactLength}` : `>= ${fact.minLength}`}, establishing index ${k} is in-bounds.`,
              };
            }
          }
        }
      } else if (
        ifStmt.elseStatement &&
        (ifStmt.elseStatement === curr ||
          (ts.isBlock(ifStmt.elseStatement) && ifStmt.elseStatement.statements.includes(curr as tsType.Statement)) ||
          isNodeDescendantOf(curr, ifStmt.elseStatement))
      ) {
        const fact = parseExitGuardedLengthCondition(ifStmt.expression, arrayTarget, ts, checker);
        if (fact) {
          const maxAllowed = fact.exactLength ?? fact.minLength;
          if (k < maxAllowed) {
            if (!hasMutationBeforeNode(ifStmt.elseStatement, node, arrayTarget.text, ts, checker, arrayTarget.symbol)) {
              return {
                isGuarded: true,
                evidence: `Enclosing guard 'else' of '${ifStmt.expression.getText()}' proves '${arrayTarget.text}' has length ${fact.exactLength !== undefined ? `=== ${fact.exactLength}` : `>= ${fact.minLength}`}, establishing index ${k} is in-bounds.`,
              };
            }
          }
        }
      }
    }

    // Case B: Logical AND expression: arr.length === 2 && arr[0]!
    if (
      ts.isBinaryExpression(curr.parent) &&
      curr.parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      (curr.parent.right === curr || isNodeDescendantOf(curr, curr.parent.right))
    ) {
      const fact = parseGuardedLengthCondition(curr.parent.left, arrayTarget, ts, checker);
      if (fact) {
        const maxAllowed = fact.exactLength ?? fact.minLength;
        if (k < maxAllowed) {
          if (!hasMutationBeforeNode(curr.parent.right, node, arrayTarget.text, ts, checker, arrayTarget.symbol)) {
            return {
              isGuarded: true,
              evidence: `Logical AND guard '${curr.parent.left.getText()}' proves '${arrayTarget.text}' has length ${fact.exactLength !== undefined ? `=== ${fact.exactLength}` : `>= ${fact.minLength}`}, establishing index ${k} is in-bounds.`,
            };
          }
        }
      }
    }

    // Case C: ConditionalExpression: arr.length === 2 ? arr[0]! : fallback
    if (ts.isConditionalExpression(curr.parent)) {
      const condExpr = curr.parent;
      if (condExpr.whenTrue === curr || isNodeDescendantOf(curr, condExpr.whenTrue)) {
        const fact = parseGuardedLengthCondition(condExpr.condition, arrayTarget, ts, checker);
        if (fact) {
          const maxAllowed = fact.exactLength ?? fact.minLength;
          if (k < maxAllowed) {
            if (!hasMutationBeforeNode(condExpr.whenTrue, node, arrayTarget.text, ts, checker, arrayTarget.symbol)) {
              return {
                isGuarded: true,
                evidence: `Ternary guard '${condExpr.condition.getText()}' proves '${arrayTarget.text}' has length ${fact.exactLength !== undefined ? `=== ${fact.exactLength}` : `>= ${fact.minLength}`}, establishing index ${k} is in-bounds.`,
              };
            }
          }
        }
      } else if (condExpr.whenFalse === curr || isNodeDescendantOf(curr, condExpr.whenFalse)) {
        const fact = parseExitGuardedLengthCondition(condExpr.condition, arrayTarget, ts, checker);
        if (fact) {
          const maxAllowed = fact.exactLength ?? fact.minLength;
          if (k < maxAllowed) {
            if (!hasMutationBeforeNode(condExpr.whenFalse, node, arrayTarget.text, ts, checker, arrayTarget.symbol)) {
              return {
                isGuarded: true,
                evidence: `Ternary false branch of '${condExpr.condition.getText()}' proves '${arrayTarget.text}' has length ${fact.exactLength !== undefined ? `=== ${fact.exactLength}` : `>= ${fact.minLength}`}, establishing index ${k} is in-bounds.`,
              };
            }
          }
        }
      }
    }

    curr = curr.parent;
  }

  // 2. Check dominating early-exit guards in prior sibling statements
  let stmt: tsType.Node = node;
  while (
    stmt.parent &&
    !ts.isBlock(stmt.parent) &&
    !ts.isSourceFile(stmt.parent) &&
    !ts.isCaseClause(stmt.parent) &&
    !ts.isDefaultClause(stmt.parent)
  ) {
    stmt = stmt.parent;
  }

  const container = stmt.parent;
  if (
    container &&
    (ts.isBlock(container) ||
      ts.isSourceFile(container) ||
      ts.isCaseClause(container) ||
      ts.isDefaultClause(container))
  ) {
    const statements = container.statements;
    const targetIndex = statements.indexOf(stmt as tsType.Statement);

    if (targetIndex > 0) {
      for (let i = 0; i < targetIndex; i++) {
        const prior = statements[i];
        if (!prior) continue;

        if (ts.isIfStatement(prior) && statementExitsControlFlow(prior.thenStatement, ts)) {
          const fact = parseExitGuardedLengthCondition(prior.expression, arrayTarget, ts, checker);
          if (fact) {
            const maxAllowed = fact.exactLength ?? fact.minLength;
            if (k < maxAllowed) {
              let hasInterveningMutation = false;
              for (let m = i + 1; m < targetIndex; m++) {
                const s = statements[m];
                if (s && hasArrayMutation(s, arrayTarget.text, ts, checker, arrayTarget.symbol)) {
                  hasInterveningMutation = true;
                  break;
                }
              }
              if (
                !hasInterveningMutation &&
                !hasMutationBeforeNode(stmt, node, arrayTarget.text, ts, checker, arrayTarget.symbol)
              ) {
                return {
                  isGuarded: true,
                  evidence: `Dominating guard '${prior.expression.getText()}' proves '${arrayTarget.text}' has length ${fact.exactLength !== undefined ? `=== ${fact.exactLength}` : `>= ${fact.minLength}`}, establishing index ${k} is in-bounds.`,
                };
              }
            }
          }
        }
      }
    }
  }

  return undefined;
}

/**
 * Checks if a call expression is a genuine Array.prototype method call (e.g. map or forEach).
 */
function isBuiltinArrayMethodCall(
  call: tsType.CallExpression,
  methodName: "map" | "forEach",
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): boolean {
  if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== methodName) {
    return false;
  }

  const callerExpr = unwrapExpression(call.expression.expression, ts);

  // Array literals: [1, 2].map(...)
  if (ts.isArrayLiteralExpression(callerExpr)) {
    return true;
  }

  if (checker) {
    const callerType = checker.getTypeAtLocation(callerExpr);
    if (checker.isArrayType(callerType) || checker.isTupleType(callerType)) {
      return true;
    }

    const methodSym = checker.getSymbolAtLocation(call.expression);
    if (methodSym) {
      const decls = methodSym.getDeclarations();
      if (decls && decls.length > 0) {
        for (const d of decls) {
          const sf = d.getSourceFile();
          if (
            sf.isDeclarationFile &&
            (sf.fileName.includes("lib.es") ||
              sf.fileName.includes("lib.core") ||
              sf.fileName.includes("lib.d.ts") ||
              sf.fileName.includes("typescript/lib"))
          ) {
            const parentName = d.parent && ts.isInterfaceDeclaration(d.parent) ? d.parent.name.text : undefined;
            if (
              parentName === "Array" ||
              parentName === "ReadonlyArray" ||
              parentName === "ConcatArray" ||
              parentName?.includes("Array")
            ) {
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  return false;
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
      if (forStmt.condition) {
        const conjuncts: tsType.BinaryExpression[] = [];
        function collectConjuncts(e: tsType.Expression) {
          const u = unwrapExpression(e, ts);
          if (ts.isBinaryExpression(u) && u.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
            collectConjuncts(u.left);
            collectConjuncts(u.right);
          } else if (ts.isBinaryExpression(u)) {
            conjuncts.push(u);
          }
        }
        collectConjuncts(forStmt.condition);

        for (const cond of conjuncts) {
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
          if (isBuiltinArrayMethodCall(call, method, ts, checker)) {
            const callback = curr.parent as tsType.ArrowFunction | tsType.FunctionExpression;
            const indexParam = callback.parameters[1];
            const arrayParam = callback.parameters[2];

            if (indexParam && ts.isIdentifier(indexParam.name) && indexParam.name.text === indexInfo.baseText) {
              const callerExpr = call.expression.expression;
              const directCallerArr = normalizeArrayTarget(callerExpr, ts, checker);
              const arrayParamTarget =
                arrayParam && ts.isIdentifier(arrayParam.name)
                  ? normalizeArrayTarget(arrayParam.name, ts, checker)
                  : undefined;

              const collectionTargets: NormalizedArray[] = [];
              if (directCallerArr) collectionTargets.push(directCallerArr);
              if (arrayParamTarget) collectionTargets.push(arrayParamTarget);

              const isIteratedCollectionAccess = collectionTargets.some((t) => arraysMatch(arrayTarget, t));

              if (isIteratedCollectionAccess) {
                // Check if any mutation occurred before node in the callback
                let hasMutation = false;
                for (const target of collectionTargets) {
                  if (hasMutationBeforeNode(callback, node, target.text, ts, checker, target.symbol)) {
                    hasMutation = true;
                    break;
                  }
                }

                if (!hasMutation) {
                  // Sub-case 2a: Direct index access (offset 0): arr[i]! or array[i]!
                  if (indexInfo.offset === 0) {
                    const targetName =
                      arrayParamTarget && arraysMatch(arrayTarget, arrayParamTarget)
                        ? arrayParamTarget.text
                        : directCallerArr
                        ? directCallerArr.text
                        : arrayTarget.text;
                    return {
                      isGuarded: true,
                      evidence: `Index '${indexInfo.baseText}' is callback index parameter for '${directCallerArr ? directCallerArr.text : targetName}.${method}'.`,
                    };
                  }

                  // Sub-case 2b: Offset > 0 e.g. array[i + 1]! or arr[i + 1]!
                  // Check if inside callback there is an enclosing guard or dominating exit guard
                  let innerNode: tsType.Node = node;
                  while (innerNode && innerNode !== callback) {
                    // Form 1: if (i < arr.length - K) or if (i < array.length - K)
                    if (innerNode.parent && ts.isIfStatement(innerNode.parent)) {
                      if (
                        innerNode.parent.thenStatement === innerNode ||
                        (ts.isBlock(innerNode.parent.thenStatement) &&
                          innerNode.parent.thenStatement.statements.includes(innerNode as tsType.Statement)) ||
                        isNodeDescendantOf(innerNode, innerNode.parent.thenStatement)
                      ) {
                        const ifCond = innerNode.parent.expression;
                        const unwrappedCond = unwrapExpression(ifCond, ts);
                        if (ts.isBinaryExpression(unwrappedCond)) {
                          const condLeft = unwrapExpression(unwrappedCond.left, ts);
                          const condRight = unwrapExpression(unwrappedCond.right, ts);
                          const condOp = unwrappedCond.operatorToken.kind;
                          if (ts.isIdentifier(condLeft) && condLeft.text === indexInfo.baseText) {
                            if (condOp === ts.SyntaxKind.LessThanToken) {
                              const lengthMinus = parseArrayLengthOffset(condRight, collectionTargets, ts, checker);
                              if (lengthMinus !== undefined && indexInfo.offset >= 0 && indexInfo.offset <= lengthMinus) {
                                return {
                                  isGuarded: true,
                                  evidence: `Callback index '${indexInfo.baseText}' is guarded non-negative and bounded by '${innerNode.parent.expression.getText()}'.`,
                                };
                              }
                            }
                            if (condOp === ts.SyntaxKind.LessThanEqualsToken) {
                              const lengthMinus = parseArrayLengthOffset(condRight, collectionTargets, ts, checker);
                              if (
                                lengthMinus !== undefined &&
                                lengthMinus >= 1 &&
                                indexInfo.offset >= 0 &&
                                indexInfo.offset <= lengthMinus - 1
                              ) {
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

                    // Form 2: JSX logical AND expression: {i < array.length - K && <Element ... />}
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
                              const lengthMinus = parseArrayLengthOffset(cRight, collectionTargets, ts, checker);
                              if (lengthMinus !== undefined && indexInfo.offset >= 0 && indexInfo.offset <= lengthMinus) {
                                return {
                                  isGuarded: true,
                                  evidence: `Callback index '${indexInfo.baseText}' is guarded non-negative and bounded by '${condLeft.getText()}'.`,
                                };
                              }
                            }
                            if (cOp === ts.SyntaxKind.LessThanEqualsToken) {
                              const lengthMinus = parseArrayLengthOffset(cRight, collectionTargets, ts, checker);
                              if (
                                lengthMinus !== undefined &&
                                lengthMinus >= 1 &&
                                indexInfo.offset >= 0 &&
                                indexInfo.offset <= lengthMinus - 1
                              ) {
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

                  // Form 3: Dominating exit guard in statements of callback body
                  if (ts.isBlock(callback.body)) {
                    let stmtNode: tsType.Node = node;
                    while (stmtNode.parent && stmtNode.parent !== callback.body) {
                      stmtNode = stmtNode.parent;
                    }
                    const cbStmts = callback.body.statements;
                    const targetIdx = cbStmts.indexOf(stmtNode as tsType.Statement);
                    if (targetIdx > 0) {
                      for (let s = 0; s < targetIdx; s++) {
                        const prior = cbStmts[s];
                        if (prior && ts.isIfStatement(prior) && statementExitsControlFlow(prior.thenStatement, ts)) {
                          const unwrappedCond = unwrapExpression(prior.expression, ts);
                          if (ts.isBinaryExpression(unwrappedCond)) {
                            const cLeft = unwrapExpression(unwrappedCond.left, ts);
                            const cRight = unwrapExpression(unwrappedCond.right, ts);
                            const cOp = unwrappedCond.operatorToken.kind;
                            if (ts.isIdentifier(cLeft) && cLeft.text === indexInfo.baseText) {
                              if (cOp === ts.SyntaxKind.GreaterThanEqualsToken) {
                                const lengthMinus = parseArrayLengthOffset(cRight, collectionTargets, ts, checker);
                                if (lengthMinus !== undefined && indexInfo.offset >= 0 && indexInfo.offset <= lengthMinus) {
                                  return {
                                    isGuarded: true,
                                    evidence: `Callback index '${indexInfo.baseText}' is guarded non-negative and bounded by exit guard '${prior.expression.getText()}'.`,
                                  };
                                }
                              }
                              if (cOp === ts.SyntaxKind.GreaterThanToken) {
                                const lengthMinus = parseArrayLengthOffset(cRight, collectionTargets, ts, checker);
                                if (
                                  lengthMinus !== undefined &&
                                  lengthMinus >= 1 &&
                                  indexInfo.offset >= 0 &&
                                  indexInfo.offset <= lengthMinus - 1
                                ) {
                                  return {
                                    isGuarded: true,
                                    evidence: `Callback index '${indexInfo.baseText}' is guarded non-negative and bounded by exit guard '${prior.expression.getText()}'.`,
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
              }
              // Sub-case 2c: Sliced caller array: arr.slice(0, -K).map((_, i) => arr[i + offset]!)
              if (ts.isCallExpression(callerExpr) && ts.isPropertyAccessExpression(callerExpr.expression)) {
                const sliceMethod = callerExpr.expression.name.text;
                if (sliceMethod === "slice") {
                  const sliceReceiver = normalizeArrayTarget(callerExpr.expression.expression, ts, checker);
                  if (sliceReceiver && arraysMatch(sliceReceiver, arrayTarget)) {
                    const sliceArgs = callerExpr.arguments;
                    let startZero = false;
                    let endMinusK: number | undefined;

                    if (sliceArgs.length === 2) {
                      const arg0 = unwrapExpression(sliceArgs[0]!, ts);
                      const arg1 = unwrapExpression(sliceArgs[1]!, ts);
                      if (ts.isNumericLiteral(arg0) && arg0.text === "0") {
                        startZero = true;
                      }
                      if (
                        ts.isPrefixUnaryExpression(arg1) &&
                        arg1.operator === ts.SyntaxKind.MinusToken &&
                        ts.isNumericLiteral(arg1.operand)
                      ) {
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
 * Checks if a node or its subtrees contain mutating operations on the given array text/symbol.
 */
function hasArrayMutation(
  node: tsType.Node,
  arrayText: string,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined,
  arraySymbol?: tsType.Symbol | undefined
): boolean {
  let mutated = false;
  function check(n: tsType.Node) {
    if (mutated) return;
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const target = normalizeArrayTarget(n.expression.expression, ts, checker);
      if (target && (target.text === arrayText || (arraySymbol && target.symbol === arraySymbol))) {
        const method = n.expression.name.text;
        if (
          method === "splice" ||
          method === "pop" ||
          method === "shift" ||
          method === "unshift" ||
          method === "push" ||
          method === "fill" ||
          method === "reverse" ||
          method === "sort" ||
          method === "copyWithin"
        ) {
          mutated = true;
          return;
        }
      }
    }
    // a.length = ... or a = ...
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = unwrapExpression(n.left, ts);
      if (ts.isPropertyAccessExpression(left) && left.name.text === "length") {
        const target = normalizeArrayTarget(left.expression, ts, checker);
        if (target && (target.text === arrayText || (arraySymbol && target.symbol === arraySymbol))) {
          mutated = true;
          return;
        }
      }
      if (ts.isIdentifier(left) && left.text === arrayText) {
        mutated = true;
        return;
      }
      if (ts.isPropertyAccessExpression(left) && left.getText() === arrayText) {
        mutated = true;
        return;
      }
    }
    n.forEachChild(check);
  }
  check(node);
  return mutated;
}

function containsControlFlowExit(body: tsType.Node, ts: typeof tsType): boolean {
  let hasExit = false;
  function check(n: tsType.Node) {
    if (hasExit) return;
    if (
      ts.isBreakStatement(n) ||
      ts.isContinueStatement(n) ||
      ts.isReturnStatement(n) ||
      ts.isThrowStatement(n) ||
      ts.isYieldExpression(n)
    ) {
      hasExit = true;
      return;
    }
    // Do not recurse into nested function bodies
    if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)) {
      return;
    }
    n.forEachChild(check);
  }
  check(body);
  return hasExit;
}

function countUnconditionalPushes(
  body: tsType.Node,
  arrayText: string,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined,
  arraySymbol?: tsType.Symbol | undefined
): number {
  let conditionalPush = false;
  let pushCalls = 0;

  function scanNode(n: tsType.Node, insideConditional: boolean) {
    if (conditionalPush) return;

    if (
      ts.isIfStatement(n) ||
      ts.isSwitchStatement(n) ||
      ts.isConditionalExpression(n) ||
      ts.isTryStatement(n) ||
      ts.isWhileStatement(n) ||
      ts.isDoStatement(n) ||
      ts.isForStatement(n) ||
      ts.isForOfStatement(n) ||
      ts.isForInStatement(n)
    ) {
      n.forEachChild((c) => scanNode(c, true));
      return;
    }

    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const target = normalizeArrayTarget(n.expression.expression, ts, checker);
      if (target && (target.text === arrayText || (arraySymbol && target.symbol === arraySymbol))) {
        if (n.expression.name.text === "push") {
          if (insideConditional) {
            conditionalPush = true;
            return;
          }
          pushCalls += Math.max(1, n.arguments.length);
        }
      }
    }

    n.forEachChild((c) => scanNode(c, insideConditional));
  }

  scanNode(body, false);
  if (conditionalPush) return 0;
  return pushCalls;
}

function hasMutationBeforeNode(
  statementNode: tsType.Node,
  targetNode: tsType.Node,
  arrayText: string,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined,
  arraySymbol?: tsType.Symbol | undefined
): boolean {
  if (statementNode === targetNode) return false;
  let mutatedBefore = false;
  function check(n: tsType.Node) {
    if (mutatedBefore) return;
    if (n.pos >= targetNode.pos) return;
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const target = normalizeArrayTarget(n.expression.expression, ts, checker);
      if (target && (target.text === arrayText || (arraySymbol && target.symbol === arraySymbol))) {
        const method = n.expression.name.text;
        if (
          method === "splice" ||
          method === "pop" ||
          method === "shift" ||
          method === "unshift" ||
          method === "push" ||
          method === "fill" ||
          method === "reverse" ||
          method === "sort" ||
          method === "copyWithin"
        ) {
          mutatedBefore = true;
          return;
        }
      }
    }
    // a.length = ... or a = ...
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = unwrapExpression(n.left, ts);
      if (ts.isPropertyAccessExpression(left) && left.name.text === "length") {
        const target = normalizeArrayTarget(left.expression, ts, checker);
        if (target && (target.text === arrayText || (arraySymbol && target.symbol === arraySymbol))) {
          mutatedBefore = true;
          return;
        }
      }
      if (ts.isIdentifier(left) && left.text === arrayText) {
        mutatedBefore = true;
        return;
      }
      if (ts.isPropertyAccessExpression(left) && left.getText() === arrayText) {
        mutatedBefore = true;
        return;
      }
    }
    n.forEachChild(check);
  }
  check(statementNode);
  return mutatedBefore;
}

/**
 * Checks if an array is locally constructed with a known initial length and guaranteed loop pushes,
 * proving that an element access is strictly in-bounds.
 */
function isConstructedArrayCardinalityBoundedIndex(
  node: tsType.NonNullExpression,
  operand: tsType.ElementAccessExpression,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): GuardCheckResult | undefined {
  const arrayTarget = normalizeArrayTarget(operand.expression, ts, checker);
  if (!arrayTarget) return undefined;

  const unwrappedArray = unwrapExpression(operand.expression, ts);
  if (!ts.isIdentifier(unwrappedArray)) return undefined;

  let symbol = checker?.getSymbolAtLocation(unwrappedArray);
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
  if (!ts.isArrayLiteralExpression(init)) return undefined;

  const initialLength = init.elements.length;

  // Find the block or source file containing the declaration
  let declScope: tsType.Node = decl;
  while (declScope.parent && !ts.isBlock(declScope.parent) && !ts.isSourceFile(declScope.parent)) {
    declScope = declScope.parent;
  }
  const container = declScope.parent;
  if (!container || (!ts.isBlock(container) && !ts.isSourceFile(container))) return undefined;

  const stmts = container.statements;
  const declIdx = stmts.indexOf(declScope as tsType.Statement);
  if (declIdx === -1) return undefined;

  // Find the top-level statement in `container` that contains `node`
  let nodeScope: tsType.Node = node;
  while (nodeScope.parent && nodeScope.parent !== container) {
    nodeScope = nodeScope.parent;
  }
  const targetIdx = stmts.indexOf(nodeScope as tsType.Statement);
  if (targetIdx === -1 || targetIdx < declIdx) return undefined;

  // Look for an intervening ForStatement that unconditionally pushes to arrayTarget
  for (let sIdx = declIdx + 1; sIdx <= targetIdx; sIdx++) {
    const candidateStmt = stmts[sIdx];
    if (!candidateStmt) continue;

    if (ts.isForStatement(candidateStmt)) {
      const forStmt = candidateStmt;

      // 1. Initializer: let i = 0
      let initVal = 0;
      let loopVarName: string | undefined;
      if (forStmt.initializer && ts.isVariableDeclarationList(forStmt.initializer)) {
        const d = forStmt.initializer.declarations[0];
        if (d && ts.isIdentifier(d.name)) {
          loopVarName = d.name.text;
          if (d.initializer && ts.isNumericLiteral(d.initializer)) {
            initVal = Number(d.initializer.text);
          }
        }
      }
      if (!loopVarName || initVal !== 0) continue;

      // 2. Condition: i < N or i <= N - 1
      if (!forStmt.condition) continue;
      const cond = unwrapExpression(forStmt.condition, ts);
      if (!ts.isBinaryExpression(cond)) continue;

      const condLeft = unwrapExpression(cond.left, ts);
      if (!ts.isIdentifier(condLeft) || condLeft.text !== loopVarName) continue;

      const condOp = cond.operatorToken.kind;
      const condRight = unwrapExpression(cond.right, ts);

      let symbolicBoundText: string | undefined;
      let constantBoundValue: number | undefined;

      if (condOp === ts.SyntaxKind.LessThanToken) {
        if (ts.isIdentifier(condRight)) {
          symbolicBoundText = condRight.text;
        } else if (ts.isNumericLiteral(condRight)) {
          constantBoundValue = Number(condRight.text);
        }
      } else if (condOp === ts.SyntaxKind.LessThanEqualsToken) {
        if (ts.isBinaryExpression(condRight) && condRight.operatorToken.kind === ts.SyntaxKind.MinusToken) {
          const rLeft = unwrapExpression(condRight.left, ts);
          const rRight = unwrapExpression(condRight.right, ts);
          if (ts.isNumericLiteral(rRight) && rRight.text === "1") {
            if (ts.isIdentifier(rLeft)) {
              symbolicBoundText = rLeft.text;
            } else if (ts.isNumericLiteral(rLeft)) {
              constantBoundValue = Number(rLeft.text);
            }
          }
        }
      }

      if (!symbolicBoundText && constantBoundValue === undefined) continue;

      // 3. Loop body invariant: no control flow exits (break, continue, return, throw)
      if (containsControlFlowExit(forStmt.statement, ts)) continue;

      // 4. Count unconditional pushes to arrayTarget in the loop body
      const pushCount = countUnconditionalPushes(forStmt.statement, arrayTarget.text, ts, checker, symbol);
      if (pushCount === 0) continue;

      // 5. Ensure no mutating operations on arrayTarget occurred between forStmt and nodeScope
      let hasInterveningMutation = false;
      for (let m = sIdx + 1; m < targetIdx; m++) {
        const stmt = stmts[m];
        if (stmt && hasArrayMutation(stmt, arrayTarget.text, ts, checker, symbol)) {
          hasInterveningMutation = true;
          break;
        }
      }
      if (hasInterveningMutation) continue;

      // Check if inside nodeScope itself (before node) there is a mutation
      if (hasMutationBeforeNode(nodeScope, node, arrayTarget.text, ts, checker, symbol)) {
        continue;
      }

      const indexArg = unwrapExpression(operand.argumentExpression, ts);

      // Case A: Symbolic index matching loop bound N (e.g. amplitudes[numLayers]!)
      // Requires initialLength >= 1 and pushCount >= 1
      if (symbolicBoundText && ts.isIdentifier(indexArg) && indexArg.text === symbolicBoundText) {
        if (initialLength >= 1 && pushCount >= 1) {
          return {
            isGuarded: true,
            evidence: `Array '${arrayTarget.text}' is constructed with ${initialLength} initial element(s) and ${symbolicBoundText} guaranteed pushes, proving index '${symbolicBoundText}' is in-bounds.`,
          };
        }
      }

      // Case B: Literal numeric index matching constant loop bound C (e.g. coeffs[0]! where coeffs has 8 rows)
      if (constantBoundValue !== undefined && ts.isNumericLiteral(indexArg)) {
        const requestedIndex = Number(indexArg.text);
        const guaranteedTotalLength = initialLength + constantBoundValue * pushCount;
        if (Number.isInteger(requestedIndex) && requestedIndex >= 0 && requestedIndex < guaranteedTotalLength) {
          return {
            isGuarded: true,
            evidence: `Array '${arrayTarget.text}' is constructed with guaranteed length ${guaranteedTotalLength}, proving index ${requestedIndex} is in-bounds.`,
          };
        }
      }
    }
  }

  return undefined;
}

function isInitialNegativeOrUndefined(expr: tsType.Expression, ts: typeof tsType): boolean {
  if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.MinusToken) {
    if (ts.isNumericLiteral(expr.operand) && expr.operand.text === "1") {
      return true;
    }
  }
  if (expr.kind === ts.SyntaxKind.UndefinedKeyword || expr.kind === ts.SyntaxKind.NullKeyword) {
    return true;
  }
  if (ts.isIdentifier(expr) && expr.text === "undefined") {
    return true;
  }
  return false;
}

function isExitNegativeCheckForIndex(cond: tsType.Expression, indexName: string, ts: typeof tsType): boolean {
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

  return disjuncts.some((d) => {
    const u = unwrapExpression(d, ts);
    if (!ts.isBinaryExpression(u)) return false;
    const left = unwrapExpression(u.left, ts);
    const right = unwrapExpression(u.right, ts);
    const op = u.operatorToken.kind;

    // index === -1 or -1 === index
    if (op === ts.SyntaxKind.EqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsEqualsToken) {
      if (ts.isIdentifier(left) && left.text === indexName) {
        if (ts.isPrefixUnaryExpression(right) && right.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(right.operand) && right.operand.text === "1") {
          return true;
        }
      }
      if (ts.isIdentifier(right) && right.text === indexName) {
        if (ts.isPrefixUnaryExpression(left) && left.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(left.operand) && left.operand.text === "1") {
          return true;
        }
      }
    }

    // index < 0 or index <= -1
    if (op === ts.SyntaxKind.LessThanToken) {
      if (ts.isIdentifier(left) && left.text === indexName && ts.isNumericLiteral(right) && right.text === "0") {
        return true;
      }
    }
    if (op === ts.SyntaxKind.LessThanEqualsToken) {
      if (ts.isIdentifier(left) && left.text === indexName) {
        if (ts.isPrefixUnaryExpression(right) && right.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(right.operand) && right.operand.text === "1") {
          return true;
        }
      }
    }

    return false;
  });
}

/**
 * Checks if an index variable originates exclusively from a bounded loop search over a source array,
 * with a dominating guard proving non-negative return and matching target array.
 */
function isSearchProvenanceBoundedIndex(
  node: tsType.NonNullExpression,
  operand: tsType.ElementAccessExpression,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): GuardCheckResult | undefined {
  const targetArray = normalizeArrayTarget(operand.expression, ts, checker);
  if (!targetArray) return undefined;

  const indexArg = unwrapExpression(operand.argumentExpression, ts);
  if (!ts.isIdentifier(indexArg)) return undefined;

  const indexName = indexArg.text;

  let symbol = checker?.getSymbolAtLocation(indexArg);
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

  const rawDecl = decls[0];
  if (!rawDecl || !ts.isVariableDeclaration(rawDecl)) return undefined;
  const varDecl: tsType.VariableDeclaration = rawDecl;
  // Find the scope where index variable is declared
  let scope: tsType.Node = varDecl;
  while (scope.parent && !ts.isBlock(scope.parent) && !ts.isSourceFile(scope.parent)) {
    scope = scope.parent;
  }
  const container = scope.parent;
  if (!container || (!ts.isBlock(container) && !ts.isSourceFile(container))) return undefined;

  // Collect all assignments to indexName in container
  let sourceArrayText: string | undefined;
  let sourceArraySymbol: tsType.Symbol | undefined;
  let invalidAssignment = false;
  let hasValidLoopAssignment = false;

  function analyzeAssignments(n: tsType.Node) {
    if (invalidAssignment) return;

    // Check initializer of the declaration: let victimIdx = -1
    if (n === varDecl) {
      if (varDecl.initializer) {
        const initVal = unwrapExpression(varDecl.initializer, ts);
        if (!isInitialNegativeOrUndefined(initVal, ts)) {
          invalidAssignment = true;
          return;
        }
      }
      return;
    }

    // Check binary assignments: victimIdx = ...
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = unwrapExpression(n.left, ts);
      if (ts.isIdentifier(left) && left.text === indexName) {
        const right = unwrapExpression(n.right, ts);

        // Case 1: Reset value: -1, undefined, null
        if (isInitialNegativeOrUndefined(right, ts)) {
          return;
        }

        // Case 2: Loop variable assignment inside for (let i = 0; i < sourceArr.length; i++)
        let forNode: tsType.Node = n;
        let enclosingFor: tsType.ForStatement | undefined;
        while (forNode.parent && forNode.parent !== container) {
          if (ts.isForStatement(forNode.parent)) {
            enclosingFor = forNode.parent;
            break;
          }
          forNode = forNode.parent;
        }

        if (enclosingFor && enclosingFor.condition && ts.isBinaryExpression(enclosingFor.condition)) {
          // Check that right is the loop variable
          let loopVar: string | undefined;
          if (enclosingFor.initializer && ts.isVariableDeclarationList(enclosingFor.initializer)) {
            const d = enclosingFor.initializer.declarations[0];
            if (d && ts.isIdentifier(d.name)) {
              loopVar = d.name.text;
            }
          }

          if (loopVar && ts.isIdentifier(right) && right.text === loopVar) {
            // Check condition: loopVar < sourceArr.length
            const cond = enclosingFor.condition;
            const condLeft = unwrapExpression(cond.left, ts);
            const condRight = unwrapExpression(cond.right, ts);
            if (
              ts.isIdentifier(condLeft) &&
              condLeft.text === loopVar &&
              cond.operatorToken.kind === ts.SyntaxKind.LessThanToken &&
              ts.isPropertyAccessExpression(condRight) &&
              condRight.name.text === "length"
            ) {
              const src = normalizeArrayTarget(condRight.expression, ts, checker);
              if (src) {
                if (!sourceArrayText) {
                  sourceArrayText = src.text;
                  sourceArraySymbol = src.symbol;
                } else if (sourceArrayText !== src.text) {
                  invalidAssignment = true;
                  return;
                }
                hasValidLoopAssignment = true;
                return;
              }
            }
          }
        }

        // Any other assignment to indexName is untrusted
        invalidAssignment = true;
        return;
      }
    }

    n.forEachChild(analyzeAssignments);
  }

  analyzeAssignments(container);

  if (invalidAssignment || !hasValidLoopAssignment || !sourceArrayText) {
    return undefined;
  }

  // Check relationship between targetArray and sourceArray:
  // Either targetArray === sourceArray, OR targetArray is derived from sourceArray preserving length:
  // e.g. const copy = prev.map(...) or [...prev] or prev.slice()
  let arraysMatch = false;
  if (sourceArraySymbol && targetArray.symbol && sourceArraySymbol === targetArray.symbol) {
    arraysMatch = true;
  } else if (sourceArrayText === targetArray.text) {
    arraysMatch = true;
  } else if (targetArray.symbol) {
    const tDecls = targetArray.symbol.getDeclarations();
    if (tDecls && tDecls.length > 0) {
      const firstTDecl = tDecls[0];
      if (firstTDecl && ts.isVariableDeclaration(firstTDecl)) {
      const tInit = firstTDecl.initializer ? unwrapExpression(firstTDecl.initializer, ts) : undefined;
      if (tInit) {
        // Form 1: prev.map(...) or prev.slice()
        if (ts.isCallExpression(tInit) && ts.isPropertyAccessExpression(tInit.expression)) {
          const method = tInit.expression.name.text;
          if (method === "map" || (method === "slice" && tInit.arguments.length === 0)) {
            const baseArr = normalizeArrayTarget(tInit.expression.expression, ts, checker);
            if (baseArr && (baseArr.text === sourceArrayText || (sourceArraySymbol && baseArr.symbol === sourceArraySymbol))) {
              arraysMatch = true;
            }
          }
        }
        // Form 2: [...prev]
        if (ts.isArrayLiteralExpression(tInit) && tInit.elements.length === 1) {
          const elem = tInit.elements[0];
          if (elem && ts.isSpreadElement(elem)) {
            const baseArr = normalizeArrayTarget(elem.expression, ts, checker);
            if (baseArr && (baseArr.text === sourceArrayText || (sourceArraySymbol && baseArr.symbol === sourceArraySymbol))) {
              arraysMatch = true;
            }
          }
        }
        // Form 3: Array.from(prev)
        if (ts.isCallExpression(tInit) && ts.isPropertyAccessExpression(tInit.expression)) {
          if (tInit.expression.name.text === "from" && tInit.arguments.length >= 1) {
            const firstArg = tInit.arguments[0];
            if (firstArg) {
              const baseArr = normalizeArrayTarget(firstArg, ts, checker);
              if (baseArr && (baseArr.text === sourceArrayText || (sourceArraySymbol && baseArr.symbol === sourceArraySymbol))) {
                arraysMatch = true;
              }
            }
          }
        }
      }
      }
    }
  }

  if (!arraysMatch) return undefined;

  // Check dominating exit guard:
  // Find top statement in container enclosing node
  let nodeScope: tsType.Node = node;
  while (nodeScope.parent && nodeScope.parent !== container) {
    nodeScope = nodeScope.parent;
  }
  const stmts = container.statements;
  const targetIdx = stmts.indexOf(nodeScope as tsType.Statement);
  if (targetIdx <= 0) return undefined;

  let guardIdx = -1;
  let guardEvidence = "";

  for (let i = 0; i < targetIdx; i++) {
    const prior = stmts[i];
    if (!prior) continue;

    if (ts.isIfStatement(prior) && statementExitsControlFlow(prior.thenStatement, ts)) {
      const cond = prior.expression;
      if (isExitNegativeCheckForIndex(cond, indexName, ts)) {
        guardIdx = i;
        guardEvidence = `Dominating guard '${cond.getText()}' establishes '${indexName}' is a valid search index for '${targetArray.text}'.`;
        break;
      }
    }
  }

  if (guardIdx === -1) return undefined;

  // Verify no mutations on sourceArray or targetArray between guard and node
  for (let i = guardIdx + 1; i < targetIdx; i++) {
    const s = stmts[i];
    if (s) {
      if (hasArrayMutation(s, targetArray.text, ts, checker, targetArray.symbol)) return undefined;
      if (hasArrayMutation(s, sourceArrayText, ts, checker, sourceArraySymbol)) return undefined;
    }
  }

  return {
    isGuarded: true,
    evidence: guardEvidence,
  };
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

  const chk: tsType.TypeChecker = checker;
  const initCall = varDecl.initializer;
  if (!resolveReactHook(initCall, chk, "useState")) {
    return undefined;
  }

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

        // Sub-case 2: Functional updater: setter(s => s + 1) or setter(prev => ...)
        if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
          const updaterParam = arg.parameters[0];
          const paramText = updaterParam && ts.isIdentifier(updaterParam.name) ? updaterParam.name.text : undefined;
          let retExpr: tsType.Expression | undefined;

          if (ts.isBlock(arg.body)) {
            for (const st of arg.body.statements) {
              if (ts.isReturnStatement(st) && st.expression) {
                retExpr = unwrapExpression(st.expression, ts);
                break;
              }
            }
          } else if (ts.isExpression(arg.body)) {
            retExpr = unwrapExpression(arg.body as tsType.Expression, ts);
          }

          if (!retExpr) {
            hasInvalidSetterWrite = true;
            return;
          }

          // Bounded literal integer: s => 0
          if (ts.isNumericLiteral(retExpr)) {
            const num = Number(retExpr.text);
            if (Number.isInteger(num) && num >= 0 && num < arrayLength) {
              return;
            }
            hasInvalidSetterWrite = true;
            return;
          }

          // Increment: s => s + 1 (requires enclosing upper bound guard)
          if (
            ts.isBinaryExpression(retExpr) &&
            retExpr.operatorToken.kind === ts.SyntaxKind.PlusToken
          ) {
            const l = unwrapExpression(retExpr.left, ts);
            const r = unwrapExpression(retExpr.right, ts);
            if (
              ((paramText && ts.isIdentifier(l) && l.text === paramText) || (ts.isIdentifier(l) && l.text === stateName)) &&
              ts.isNumericLiteral(r)
            ) {
              const inc = Number(r.text);
              if (inc >= 1) {
                let isGuardedInc = false;
                let curCheck: tsType.Node = parent;
                while (curCheck.parent && curCheck.parent !== funcNode) {
                  if (ts.isIfStatement(curCheck.parent)) {
                    const ifStmt = curCheck.parent;
                    if (
                      ifStmt.thenStatement === curCheck ||
                      (ts.isBlock(ifStmt.thenStatement) && isNodeDescendantOf(curCheck, ifStmt.thenStatement))
                    ) {
                      if (isStateUpperBoundGuard(ifStmt.expression, stateName, arrayLength - inc, ts, checker)) {
                        isGuardedInc = true;
                        break;
                      }
                    }
                  }
                  curCheck = curCheck.parent;
                }
                if (isGuardedInc) return;
              }
            }
            hasInvalidSetterWrite = true;
            return;
          }

          // Decrement: s => s - 1 (requires enclosing lower bound guard)
          if (
            ts.isBinaryExpression(retExpr) &&
            retExpr.operatorToken.kind === ts.SyntaxKind.MinusToken
          ) {
            const l = unwrapExpression(retExpr.left, ts);
            const r = unwrapExpression(retExpr.right, ts);
            if (
              ((paramText && ts.isIdentifier(l) && l.text === paramText) || (ts.isIdentifier(l) && l.text === stateName)) &&
              ts.isNumericLiteral(r)
            ) {
              const dec = Number(r.text);
              if (dec >= 1) {
                let isGuardedDec = false;
                let curCheck: tsType.Node = parent;
                while (curCheck.parent && curCheck.parent !== funcNode) {
                  if (ts.isIfStatement(curCheck.parent)) {
                    const ifStmt = curCheck.parent;
                    if (
                      ifStmt.thenStatement === curCheck ||
                      (ts.isBlock(ifStmt.thenStatement) && isNodeDescendantOf(curCheck, ifStmt.thenStatement))
                    ) {
                      if (isStateLowerBoundGuard(ifStmt.expression, stateName, dec, ts, checker)) {
                        isGuardedDec = true;
                        break;
                      }
                    }
                  }
                  curCheck = curCheck.parent;
                }
                if (isGuardedDec) return;
              }
            }
            hasInvalidSetterWrite = true;
            return;
          }

          hasInvalidSetterWrite = true;
          return;
        }

        // Sub-case 3: Identifier target (e.g. setStep(target)): check if target was bounds-checked in enclosing function
        if (ts.isIdentifier(arg)) {
          const paramName = arg.text;
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
                  if (isParamBoundedCondition(stmt.expression, paramName, arrayLength, ts, true)) {
                    paramGuarded = true;
                    break;
                  }
                }
              }
            }
          }

          if (!paramGuarded) {
            // Check entry guard enclosing parent
            let curN: tsType.Node = parent;
            while (curN.parent && curN.parent !== funcNode) {
              if (ts.isIfStatement(curN.parent)) {
                const ifStmt = curN.parent;
                if (
                  ifStmt.thenStatement === curN ||
                  (ts.isBlock(ifStmt.thenStatement) && isNodeDescendantOf(curN, ifStmt.thenStatement))
                ) {
                  if (isParamBoundedCondition(ifStmt.expression, paramName, arrayLength, ts, false)) {
                    paramGuarded = true;
                    break;
                  }
                }
              }
              curN = curN.parent;
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
          const left = unwrapExpression(arg.left, ts);
          const right = unwrapExpression(arg.right, ts);
          if (ts.isIdentifier(left) && left.text === stateName && ts.isNumericLiteral(right)) {
            const offsetNum = Number(right.text);
            if (arg.operatorToken.kind === ts.SyntaxKind.PlusToken) {
              let isGuarded = false;
              let curN: tsType.Node = parent;
              while (curN.parent && curN.parent !== funcNode) {
                if (ts.isIfStatement(curN.parent)) {
                  const ifStmt = curN.parent;
                  if (
                    ifStmt.thenStatement === curN ||
                    (ts.isBlock(ifStmt.thenStatement) && isNodeDescendantOf(curN, ifStmt.thenStatement))
                  ) {
                    if (isStateUpperBoundGuard(ifStmt.expression, stateName, arrayLength - offsetNum, ts, checker)) {
                      isGuarded = true;
                      break;
                    }
                  }
                }
                curN = curN.parent;
              }
              if (isGuarded) return;
            } else if (arg.operatorToken.kind === ts.SyntaxKind.MinusToken) {
              let isGuarded = false;
              let curN: tsType.Node = parent;
              while (curN.parent && curN.parent !== funcNode) {
                if (ts.isIfStatement(curN.parent)) {
                  const ifStmt = curN.parent;
                  if (
                    ifStmt.thenStatement === curN ||
                    (ts.isBlock(ifStmt.thenStatement) && isNodeDescendantOf(curN, ifStmt.thenStatement))
                  ) {
                    if (isStateLowerBoundGuard(ifStmt.expression, stateName, offsetNum, ts, checker)) {
                      isGuarded = true;
                      break;
                    }
                  }
                }
                curN = curN.parent;
              }
              if (isGuarded) return;
            }
          }
          hasInvalidSetterWrite = true;
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
        if (
          resolveReactHook(parent, chk, "useCallback") ||
          resolveReactHook(parent, chk, "useMemo") ||
          resolveReactHook(parent, chk, "useEffect") ||
          resolveReactHook(parent, chk, "useLayoutEffect")
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
          (resolveReactHook(parent.parent, chk, "useCallback") ||
            resolveReactHook(parent.parent, chk, "useMemo") ||
            resolveReactHook(parent.parent, chk, "useEffect") ||
            resolveReactHook(parent.parent, chk, "useLayoutEffect"))
        ) {
          return;
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

    // 1b. Check fixed-length equality or comparison guards: e.g. if (sliceArgs.length === 2) sliceArgs[0]!
    const fixedLengthCheck = isFixedLengthGuardedIndex(node, operand, ts, checker);
    if (fixedLengthCheck?.isGuarded) {
      return fixedLengthCheck;
    }

    // 1c. Check constructed array cardinality: e.g. amplitudes[numLayers]! or coeffs[0]!
    const cardinalityCheck = isConstructedArrayCardinalityBoundedIndex(node, operand, ts, checker);
    if (cardinalityCheck?.isGuarded) {
      return cardinalityCheck;
    }

    // 1d. Check loop or callback bounds: e.g. for (let i = 0; i < arr.length; i++) arr[i]!
    const loopCheck = isLoopOrCallbackBoundedIndex(node, operand, ts, checker);
    if (loopCheck?.isGuarded) {
      return loopCheck;
    }

    // 1d. Check React state bounds: e.g. STEPS[step]! with constrained setStep transitions
    const reactStateCheck = isReactStateBoundedIndex(operand, ts, checker);
    if (reactStateCheck?.isGuarded) {
      return reactStateCheck;
    }

    // 1e. Check search provenance: e.g. copy[victimIdx]!
    const provenanceCheck = isSearchProvenanceBoundedIndex(node, operand, ts, checker);
    if (provenanceCheck?.isGuarded) {
      return provenanceCheck;
    }

    // 1f. Check findIndex contract: e.g. const i = arr.findIndex(...); if (i !== -1) arr[i]!
    const findIndexCheck = isFindIndexBoundedIndex(node, operand, ts, checker);
    if (findIndexCheck?.isGuarded) {
      return findIndexCheck;
    }
    // 1g. Dominating statement-level bounds exit check: if (index < 0 || index >= array.length) return;
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
    const targetSymbol = checker?.getSymbolAtLocation(operand);
    let resolvedTargetSymbol = targetSymbol;
    if (resolvedTargetSymbol && (resolvedTargetSymbol.flags & ts.SymbolFlags.Alias) !== 0) {
      try {
        resolvedTargetSymbol = checker?.getAliasedSymbol(resolvedTargetSymbol);
      } catch {
        // ignore
      }
    }

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
            let isGuardMatched = false;
            let evidenceStr = "";

            // 1. if (!target) return;
            if (ts.isPrefixUnaryExpression(cond) && cond.operator === ts.SyntaxKind.ExclamationToken) {
              const inner = unwrapExpression(cond.operand, ts);
              if (ts.isIdentifier(inner)) {
                const innerSym = checker?.getSymbolAtLocation(inner);
                let resolvedInnerSym = innerSym;
                if (resolvedInnerSym && (resolvedInnerSym.flags & ts.SymbolFlags.Alias) !== 0) {
                  try {
                    resolvedInnerSym = checker?.getAliasedSymbol(resolvedInnerSym);
                  } catch {
                    // ignore
                  }
                }
                const matchesSymbol =
                  resolvedTargetSymbol && resolvedInnerSym
                    ? resolvedInnerSym === resolvedTargetSymbol
                    : inner.text === targetName;

                if (matchesSymbol) {
                  isGuardMatched = true;
                  evidenceStr = `Dominating guard '!${targetName}' proves operand is non-null.`;
                }
              }
            }

            // 2. if (target === null || target === undefined || target == null) return;
            if (!isGuardMatched && ts.isBinaryExpression(cond)) {
              const left = unwrapExpression(cond.left, ts);
              const right = unwrapExpression(cond.right, ts);
              const op = cond.operatorToken.kind;
              if (
                op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
                op === ts.SyntaxKind.EqualsEqualsToken
              ) {
                let targetSide: tsType.Identifier | undefined;
                let nullSide: tsType.Expression | undefined;
                if (ts.isIdentifier(left)) {
                  targetSide = left;
                  nullSide = right;
                } else if (ts.isIdentifier(right)) {
                  targetSide = right;
                  nullSide = left;
                }

                if (targetSide && nullSide) {
                  const innerSym = checker?.getSymbolAtLocation(targetSide);
                  let resolvedInnerSym = innerSym;
                  if (resolvedInnerSym && (resolvedInnerSym.flags & ts.SymbolFlags.Alias) !== 0) {
                    try {
                      resolvedInnerSym = checker?.getAliasedSymbol(resolvedInnerSym);
                    } catch {
                      // ignore
                    }
                  }
                  const matchesSymbol =
                    resolvedTargetSymbol && resolvedInnerSym
                      ? resolvedInnerSym === resolvedTargetSymbol
                      : targetSide.text === targetName;

                  if (
                    matchesSymbol &&
                    (nullSide.kind === ts.SyntaxKind.NullKeyword ||
                      nullSide.kind === ts.SyntaxKind.UndefinedKeyword ||
                      (ts.isIdentifier(nullSide) && nullSide.text === "undefined"))
                  ) {
                    isGuardMatched = true;
                    evidenceStr = `Dominating null check proves '${targetName}' is non-null.`;
                  }
                }
              }
            }

            if (isGuardMatched) {
              // Invalidation check: verify target was NOT reassigned between guard and assertion!
              let isReassigned = false;
              for (let j = i + 1; j < targetIndex; j++) {
                const s = statements[j];
                if (s && hasVariableReassignment(s, targetName, resolvedTargetSymbol, ts, checker)) {
                  isReassigned = true;
                  break;
                }
              }

              if (!isReassigned) {
                const currentStmt = statements[targetIndex];
                if (currentStmt && hasVariableReassignment(currentStmt, targetName, resolvedTargetSymbol, ts, checker, node.pos)) {
                  isReassigned = true;
                }
              }

              if (!isReassigned) {
                return {
                  isGuarded: true,
                  evidence: evidenceStr,
                };
              }
            }
          }
        }
      }
    }
  }

  return { isGuarded: false };
}
