import type * as tsType from "typescript";
import { isPromiseLike } from "../engine/symbols.js";
import { unwrapExpression } from "./values.js";
import {
  getFunctionSummary,
  resolveLocalOrProjectFunctionDeclaration,
  type FunctionSummaryContext,
} from "./functions.js";
import { evaluateFrameworkPromiseCall } from "./frameworks.js";

export interface PromiseClassification {
  readonly isPromise: boolean;
  readonly isDefinitePromise: boolean;
  readonly isOptionalPromiseUnion: boolean;
}

const classifyPromiseCache = new WeakMap<tsType.TypeChecker, WeakMap<tsType.Type, PromiseClassification>>();

/**
 * Classifies a type into definite Promise vs optional void/undefined Promise union.
 */
export function classifyPromiseType(
  type: tsType.Type | undefined,
  checker: tsType.TypeChecker,
  ts: typeof tsType
): PromiseClassification {
  if (!type) {
    return { isPromise: false, isDefinitePromise: false, isOptionalPromiseUnion: false };
  }

  let checkerCache = classifyPromiseCache.get(checker);
  if (!checkerCache) {
    checkerCache = new WeakMap<tsType.Type, PromiseClassification>();
    classifyPromiseCache.set(checker, checkerCache);
  }

  const cached = checkerCache.get(type);
  if (cached !== undefined) {
    return cached;
  }

  if (!isPromiseLike(type, checker)) {
    const res: PromiseClassification = { isPromise: false, isDefinitePromise: false, isOptionalPromiseUnion: false };
    checkerCache.set(type, res);
    return res;
  }

  if (type.isUnion()) {
    const hasVoidOrUndefined = type.types.some(
      (t) => (t.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined | ts.TypeFlags.Null)) !== 0
    );
    const hasPromise = type.types.some((t) => isPromiseLike(t, checker));
    if (hasVoidOrUndefined && hasPromise) {
      const res: PromiseClassification = {
        isPromise: true,
        isDefinitePromise: false,
        isOptionalPromiseUnion: true,
      };
      checkerCache.set(type, res);
      return res;
    }
  }

  const res: PromiseClassification = {
    isPromise: true,
    isDefinitePromise: true,
    isOptionalPromiseUnion: false,
  };
  checkerCache.set(type, res);
  return res;
}

function isUndefinedOrNullNode(node: tsType.Node, ts: typeof tsType): boolean {
  if (ts.isIdentifier(node) && node.text === "undefined") return true;
  if (node.kind === ts.SyntaxKind.NullKeyword || node.kind === ts.SyntaxKind.UndefinedKeyword) return true;
  return false;
}

/**
 * Inspects a Promise method chain to determine whether it terminates in an effective rejection handler.
 * Supports:
 * - `.catch(onRejected)`
 * - `.then(onFulfilled, onRejected)` (with valid onRejected)
 * - `.catch(onRejected).finally(cleanup)`
 * - `.then(onFulfilled, onRejected).finally(cleanup)`
 *
 * Rejects as NOT terminal-handled:
 * - `.finally(cleanup)` (without preceding catch on a rejecting base)
 * - `.then(onFulfilled).finally(cleanup)`
 * - `.catch(onRejected).then(onFulfilled)` (new unhandled then step)
 */
export function hasTerminalRejectionHandling(
  expr: tsType.Expression,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): boolean {
  const current = unwrapExpression(expr, ts);

  if (!ts.isCallExpression(current)) {
    return false;
  }

  const callee = current.expression;
  if (!ts.isPropertyAccessExpression(callee)) {
    return false;
  }

  const methodName = callee.name.text;

  // 1. Direct terminal .catch(onRejected)
  if (methodName === "catch") {
    const args = current.arguments;
    if (args.length >= 1 && args[0] && !isUndefinedOrNullNode(args[0], ts)) {
      return true;
    }
  }

  // 2. Direct terminal .then(onFulfilled, onRejected)
  if (methodName === "then") {
    const args = current.arguments;
    if (args.length >= 2 && args[1] && !isUndefinedOrNullNode(args[1], ts)) {
      return true;
    }
  }

  // 3. Terminal .finally(cleanup) preceded by a rejection-handled chain
  // e.g. verify().then(...).catch(handleError).finally(cleanup)
  if (methodName === "finally") {
    const receiver = callee.expression;
    if (receiver && hasTerminalRejectionHandling(receiver, ts, checker)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether a variable or assignment target reaches a return statement without being overwritten.
 * Handles:
 * - Direct return of assigned variable: cached = load(); return cached;
 * - Return of alias: const p = load(); const q = p; return q;
 * - Detects and rejects overwrites: cached = load(); cached = null; return fallback;
 */
export function isVariableTargetReturnedInScope(
  node: tsType.Node,
  targetName: string,
  ts: typeof tsType
): boolean {
  // Find enclosing statement
  let stmt: tsType.Node = node;
  while (stmt.parent && !ts.isBlock(stmt.parent) && !ts.isSourceFile(stmt.parent)) {
    stmt = stmt.parent;
  }

  if (!stmt.parent) return false;
  const parentBlock = stmt.parent;
  const statements: readonly tsType.Statement[] = ts.isBlock(parentBlock)
    ? parentBlock.statements
    : ts.isSourceFile(parentBlock)
      ? parentBlock.statements
      : [];

  const startIndex = statements.indexOf(stmt as tsType.Statement);
  if (startIndex === -1) return false;

  // Set of valid return target names (includes targetName and any alias variables)
  const validReturnNames = new Set<string>([targetName]);

  function scanAssignmentsInNode(n: tsType.Node) {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const assignedLeft = unwrapExpression(n.left, ts);
      const assignedName = ts.isIdentifier(assignedLeft)
        ? assignedLeft.text
        : ts.isPropertyAccessExpression(assignedLeft)
          ? assignedLeft.getText()
          : undefined;

      if (assignedName) {
        const rhs = unwrapExpression(n.right, ts);
        if (ts.isIdentifier(rhs) && validReturnNames.has(rhs.text)) {
          validReturnNames.add(assignedName);
        } else if (validReturnNames.has(assignedName)) {
          validReturnNames.delete(assignedName);
        }
      }
    }
    n.forEachChild(scanAssignmentsInNode);
  }

  for (let i = startIndex + 1; i < statements.length; i++) {
    const currentStmt = statements[i];
    if (!currentStmt) continue;

    // Check assignments
    if (ts.isExpressionStatement(currentStmt)) {
      const expr = unwrapExpression(currentStmt.expression, ts);
      if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const assignedLeft = unwrapExpression(expr.left, ts);
        const assignedName = ts.isIdentifier(assignedLeft)
          ? assignedLeft.text
          : ts.isPropertyAccessExpression(assignedLeft)
            ? assignedLeft.getText()
            : undefined;

        if (assignedName) {
          const rhs = unwrapExpression(expr.right, ts);
          if (ts.isIdentifier(rhs) && validReturnNames.has(rhs.text)) {
            validReturnNames.add(assignedName);
          } else if (validReturnNames.has(assignedName)) {
            validReturnNames.delete(assignedName);
          }
        }
      }
    }

    // Check for alias declarations: const alias = targetName;
    if (ts.isVariableStatement(currentStmt)) {
      for (const decl of currentStmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const declName = decl.name.text;
          if (decl.initializer) {
            const init = unwrapExpression(decl.initializer, ts);
            if (ts.isIdentifier(init) && validReturnNames.has(init.text)) {
              validReturnNames.add(declName);
            } else if (validReturnNames.has(declName)) {
              validReturnNames.delete(declName);
            }
          }
        }
      }
    }

    // Conditional structures that reassign aliases invalidate those aliases conservatively
    if (
      ts.isIfStatement(currentStmt) ||
      ts.isSwitchStatement(currentStmt) ||
      ts.isTryStatement(currentStmt) ||
      ts.isForStatement(currentStmt) ||
      ts.isForOfStatement(currentStmt) ||
      ts.isForInStatement(currentStmt) ||
      ts.isWhileStatement(currentStmt) ||
      ts.isDoStatement(currentStmt)
    ) {
      currentStmt.forEachChild(scanAssignmentsInNode);
    }

    // Check for return statement
    if (ts.isReturnStatement(currentStmt) && currentStmt.expression) {
      const unwrappedRet = unwrapExpression(currentStmt.expression, ts);
      if (ts.isIdentifier(unwrappedRet) && validReturnNames.has(unwrappedRet.text)) {
        return true;
      }
      if (ts.isPropertyAccessExpression(unwrappedRet) && validReturnNames.has(unwrappedRet.getText())) {
        return true;
      }
      // Reached an early return of something else -> does not reach return
      return false;
    }
  }

  // Also inspect enclosing function/block if the assignment was inside an if-statement:
  // e.g. if (!cached) { cached = import(...); } return cached;
  let outerStatement: tsType.Node = parentBlock;
  while (outerStatement.parent && !ts.isBlock(outerStatement.parent) && !ts.isSourceFile(outerStatement.parent)) {
    outerStatement = outerStatement.parent;
  }

  if (outerStatement.parent && (ts.isBlock(outerStatement.parent) || ts.isSourceFile(outerStatement.parent))) {
    const outerBlock = outerStatement.parent;
    const outerStmts: readonly tsType.Statement[] = ts.isBlock(outerBlock)
      ? outerBlock.statements
      : outerBlock.statements;

    const outerStartIndex = outerStmts.indexOf(outerStatement as tsType.Statement);
    if (outerStartIndex !== -1) {
      for (let j = outerStartIndex + 1; j < outerStmts.length; j++) {
        const outerS = outerStmts[j];
        if (!outerS) continue;

        if (ts.isExpressionStatement(outerS)) {
          const expr = unwrapExpression(outerS.expression, ts);
          if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
            const assignedLeft = unwrapExpression(expr.left, ts);
            const assignedName = ts.isIdentifier(assignedLeft)
              ? assignedLeft.text
              : ts.isPropertyAccessExpression(assignedLeft)
                ? assignedLeft.getText()
                : undefined;

            if (assignedName) {
              const rhs = unwrapExpression(expr.right, ts);
              if (ts.isIdentifier(rhs) && validReturnNames.has(rhs.text)) {
                validReturnNames.add(assignedName);
              } else if (validReturnNames.has(assignedName)) {
                validReturnNames.delete(assignedName);
              }
            }
          }
        }

        if (ts.isVariableStatement(outerS)) {
          for (const decl of outerS.declarationList.declarations) {
            if (ts.isIdentifier(decl.name)) {
              const declName = decl.name.text;
              if (decl.initializer) {
                const init = unwrapExpression(decl.initializer, ts);
                if (ts.isIdentifier(init) && validReturnNames.has(init.text)) {
                  validReturnNames.add(declName);
                } else if (validReturnNames.has(declName)) {
                  validReturnNames.delete(declName);
                }
              }
            }
          }
        }

        if (
          ts.isIfStatement(outerS) ||
          ts.isSwitchStatement(outerS) ||
          ts.isTryStatement(outerS) ||
          ts.isForStatement(outerS) ||
          ts.isForOfStatement(outerS) ||
          ts.isForInStatement(outerS) ||
          ts.isWhileStatement(outerS) ||
          ts.isDoStatement(outerS)
        ) {
          outerS.forEachChild(scanAssignmentsInNode);
        }

        if (ts.isReturnStatement(outerS) && outerS.expression) {
          const unwrappedRet = unwrapExpression(outerS.expression, ts);
          if (ts.isIdentifier(unwrappedRet) && validReturnNames.has(unwrappedRet.text)) {
            return true;
          }
          if (ts.isPropertyAccessExpression(unwrappedRet) && validReturnNames.has(unwrappedRet.getText())) {
            return true;
          }
          return false;
        }
      }
    }
  }

  return false;
}

export interface PromiseConsumptionResult {
  readonly isConsumed: boolean;
  readonly reason?: string | undefined;
  readonly isRejectionHandled: boolean;
}

/**
 * Evaluates whether an expression statement containing a Promise is safely consumed,
 * handled, cached, or returned.
 */
export function evaluatePromiseConsumption(
  expr: tsType.Expression,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined,
  context?: FunctionSummaryContext | undefined
): PromiseConsumptionResult {
  const unwrapped = unwrapExpression(expr, ts);

  // 1. Explicit void operator
  if (ts.isVoidExpression(unwrapped)) {
    return { isConsumed: true, reason: "Explicit void operator indicates intentional discard.", isRejectionHandled: false };
  }

  // 2. Explicit await operator
  if (ts.isAwaitExpression(unwrapped)) {
    return { isConsumed: true, reason: "Awaited.", isRejectionHandled: true };
  }

  // 3. Terminal rejection handling (.catch(...) or .then(onF, onR) or .catch(...).finally(...))
  if (hasTerminalRejectionHandling(unwrapped, ts, checker)) {
    return { isConsumed: true, reason: "Terminal rejection handler chained.", isRejectionHandled: true };
  }

  // 4. Assignment to variable/cache that is subsequently returned without overwrite
  // e.g. `cached = import(...); return cached;`
  if (ts.isBinaryExpression(unwrapped) && unwrapped.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    const left = unwrapExpression(unwrapped.left, ts);
    const targetName = ts.isIdentifier(left)
      ? left.text
      : ts.isPropertyAccessExpression(left)
        ? left.getText()
        : undefined;

    if (targetName && isVariableTargetReturnedInScope(unwrapped, targetName, ts)) {
      return { isConsumed: true, reason: "Assigned Promise reaches return from enclosing function.", isRejectionHandled: true };
    }
  }

  // 5. Verified framework API call based on symbol origin and argument inspection
  if (ts.isCallExpression(unwrapped)) {
    const frameworkCheck = evaluateFrameworkPromiseCall(unwrapped, ts, checker);
    if (frameworkCheck.isHandled) {
      return {
        isConsumed: true,
        reason: frameworkCheck.reason ?? "Verified framework API call.",
        isRejectionHandled: true,
      };
    }
  }

  return { isConsumed: false, isRejectionHandled: false };
}
