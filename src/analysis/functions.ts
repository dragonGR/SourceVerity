import type * as tsType from "typescript";
import { isPromiseLike } from "../engine/symbols.js";
import { resolveConstantValue, unwrapExpression } from "./values.js";

export type PromiseBehavior =
  | "handles-known-rejections"
  | "propagates"
  | "may-reject"
  | "unknown";

export interface FunctionSummary {
  readonly symbol?: tsType.Symbol | undefined;
  readonly isAsync: boolean;
  readonly returnsPromiseLike: boolean;
  readonly returnsOptionalPromiseUnion: boolean;
  readonly promiseBehavior: PromiseBehavior;
  readonly returnsCreatedPromise: boolean;
}

/**
 * Context for managing function summary analysis, caching, and recursion cycle detection.
 */
export class FunctionSummaryContext {
  private readonly cache = new Map<tsType.Node, FunctionSummary>();
  private readonly inProgress = new Set<tsType.Node>();

  constructor(
    readonly ts: typeof tsType,
    readonly checker?: tsType.TypeChecker | undefined
  ) {}

  getSummary(funcNode: tsType.Node): FunctionSummary {
    const cached = this.cache.get(funcNode);
    if (cached) return cached;

    if (this.inProgress.has(funcNode)) {
      // Break recursion cycle conservatively with "unknown"
      return {
        isAsync: true,
        returnsPromiseLike: true,
        returnsOptionalPromiseUnion: false,
        promiseBehavior: "unknown",
        returnsCreatedPromise: false,
      };
    }

    this.inProgress.add(funcNode);
    try {
      const summary = computeFunctionSummary(funcNode, this);
      this.cache.set(funcNode, summary);
      return summary;
    } finally {
      this.inProgress.delete(funcNode);
    }
  }
}

/**
 * Checks if an expression contains an await or throw operation.
 */
function containsAwaitOrThrow(node: tsType.Node, ts: typeof tsType): boolean {
  let found = false;
  function walk(n: tsType.Node) {
    if (found) return;
    if (ts.isAwaitExpression(n) || ts.isThrowStatement(n)) {
      found = true;
      return;
    }
    // Do not descend into nested function boundaries
    if (
      n !== node &&
      (ts.isFunctionDeclaration(n) ||
        ts.isArrowFunction(n) ||
        ts.isFunctionExpression(n) ||
        ts.isMethodDeclaration(n))
    ) {
      return;
    }
    n.forEachChild(walk);
  }
  walk(node);
  return found;
}

/**
 * Checks if a call expression is a known, non-throwing logging or lifecycle utility.
 * e.g. console.log/error/warn/info/debug/trace, clearTimeout, clearInterval, clearImmediate,
 * standard AbortController.abort(), or standard React state setters (set[A-Z]...).
 */
function isKnownSafeSynchronousCall(
  callExpr: tsType.CallExpression,
  ts: typeof tsType
): boolean {
  const callee = unwrapExpression(callExpr.expression, ts);

  // 1. Standard console logging methods: console.log / console.error / console.warn / console.info / console.debug / console.trace
  if (ts.isPropertyAccessExpression(callee)) {
    const obj = unwrapExpression(callee.expression, ts);
    if (ts.isIdentifier(obj)) {
      if (obj.text === "console") {
        return true;
      }
      if (obj.text === "abortController" || obj.text === "controller") {
        if (callee.name.text === "abort") return true;
      }
    }
  }

  // 2. Standard timer and dispatch utilities: clearTimeout, clearInterval, clearImmediate
  if (ts.isIdentifier(callee)) {
    if (
      callee.text === "clearTimeout" ||
      callee.text === "clearInterval" ||
      callee.text === "clearImmediate"
    ) {
      return true;
    }
    // React state setters: setFoo(false), setScanning(false)
    if (/^set[A-Z]/.test(callee.text)) {
      return true;
    }
  }

  return false;
}

/**
 * Checks if an expression is proven non-throwing.
 */
function isProvenNonThrowingExpression(
  expr: tsType.Expression,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): boolean {
  const unwrapped = unwrapExpression(expr, ts);

  if (
    ts.isIdentifier(unwrapped) ||
    ts.isNumericLiteral(unwrapped) ||
    ts.isStringLiteral(unwrapped) ||
    ts.isNoSubstitutionTemplateLiteral(unwrapped) ||
    unwrapped.kind === ts.SyntaxKind.TrueKeyword ||
    unwrapped.kind === ts.SyntaxKind.FalseKeyword ||
    unwrapped.kind === ts.SyntaxKind.NullKeyword ||
    unwrapped.kind === ts.SyntaxKind.UndefinedKeyword
  ) {
    return true;
  }

  if (ts.isBinaryExpression(unwrapped)) {
    return (
      isProvenNonThrowingExpression(unwrapped.left, ts, checker) &&
      isProvenNonThrowingExpression(unwrapped.right, ts, checker)
    );
  }

  if (ts.isPrefixUnaryExpression(unwrapped)) {
    return isProvenNonThrowingExpression(unwrapped.operand, ts, checker);
  }

  if (ts.isPropertyAccessExpression(unwrapped)) {
    if (checker) {
      try {
        const objType = checker.getTypeAtLocation(unwrapped.expression);
        if ((objType.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)) !== 0) {
          return false;
        }
        if (objType.isUnion()) {
          const hasNullish = objType.types.some(
            (t) => (t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)) !== 0
          );
          if (hasNullish) return false;
        }
      } catch {
        return false;
      }
    }
    return isProvenNonThrowingExpression(unwrapped.expression, ts, checker);
  }

  if (ts.isCallExpression(unwrapped)) {
    return isKnownSafeSynchronousCall(unwrapped, ts);
  }

  return false;
}

/**
 * Evaluates whether all statements in a catch block or finally block are proven non-rejecting/non-throwing.
 */
function isBlockProvenNonThrowing(
  block: tsType.Block,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): boolean {
  for (const stmt of block.statements) {
    if (ts.isThrowStatement(stmt)) {
      return false;
    }

    if (containsAwaitOrThrow(stmt, ts)) {
      return false;
    }

    if (ts.isReturnStatement(stmt)) {
      if (!stmt.expression) continue;
      const unwrappedRet = unwrapExpression(stmt.expression, ts);
      // Check if return returns Promise.reject or a function call
      if (ts.isCallExpression(unwrappedRet)) {
        return false;
      }
      if (checker) {
        try {
          const type = checker.getTypeAtLocation(unwrappedRet);
          if (isPromiseLike(type, checker)) {
            return false;
          }
        } catch {
          // ignore
        }
      }
      if (!isProvenNonThrowingExpression(unwrappedRet, ts, checker)) {
        return false;
      }
      continue;
    }

    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (decl.initializer && !isProvenNonThrowingExpression(decl.initializer, ts, checker)) {
          return false;
        }
      }
      continue;
    }

    if (ts.isExpressionStatement(stmt)) {
      const expr = unwrapExpression(stmt.expression, ts);
      if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        if (isProvenNonThrowingExpression(expr.right, ts, checker)) {
          continue;
        }
        return false;
      }
      if (ts.isCallExpression(expr)) {
        if (!isKnownSafeSynchronousCall(expr, ts)) {
          return false;
        }
        // Verify call arguments are non-throwing
        for (const arg of expr.arguments) {
          if (!isProvenNonThrowingExpression(arg, ts, checker)) {
            return false;
          }
        }
        continue;
      }
      return false;
    }

    if (ts.isIfStatement(stmt)) {
      if (!isProvenNonThrowingExpression(stmt.expression, ts, checker)) {
        return false;
      }
      if (ts.isBlock(stmt.thenStatement)) {
        if (!isBlockProvenNonThrowing(stmt.thenStatement, ts, checker)) return false;
      } else if (!isProvenNonThrowingStatement(stmt.thenStatement, ts, checker)) {
        return false;
      }
      if (stmt.elseStatement) {
        if (ts.isBlock(stmt.elseStatement)) {
          if (!isBlockProvenNonThrowing(stmt.elseStatement, ts, checker)) return false;
        } else if (!isProvenNonThrowingStatement(stmt.elseStatement, ts, checker)) {
          return false;
        }
      }
      continue;
    }

    return false;
  }

  return true;
}

function isProvenNonThrowingStatement(
  stmt: tsType.Statement,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): boolean {
  if (ts.isBlock(stmt)) {
    return isBlockProvenNonThrowing(stmt, ts, checker);
  }
  if (ts.isReturnStatement(stmt)) {
    return !stmt.expression || isProvenNonThrowingExpression(stmt.expression, ts, checker);
  }
  if (ts.isExpressionStatement(stmt)) {
    return isProvenNonThrowingExpression(stmt.expression, ts, checker);
  }
  return false;
}

/**
 * Inspects a statement outside try to confirm it cannot throw or reject.
 */
function isSafeSynchronousPreamble(
  stmt: tsType.Statement,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): boolean {
  if (containsAwaitOrThrow(stmt, ts)) {
    return false;
  }

  if (ts.isVariableStatement(stmt)) {
    for (const decl of stmt.declarationList.declarations) {
      if (decl.initializer && !isProvenNonThrowingExpression(decl.initializer, ts, checker)) {
        return false;
      }
    }
    return true;
  }

  if (ts.isReturnStatement(stmt)) {
    return !stmt.expression || isProvenNonThrowingExpression(stmt.expression, ts, checker);
  }

  if (ts.isIfStatement(stmt)) {
    if (!isProvenNonThrowingExpression(stmt.expression, ts, checker)) {
      return false;
    }
    if (ts.isBlock(stmt.thenStatement)) {
      return isBlockProvenNonThrowing(stmt.thenStatement, ts, checker);
    }
    return isProvenNonThrowingStatement(stmt.thenStatement, ts, checker);
  }

  if (ts.isExpressionStatement(stmt)) {
    return isProvenNonThrowingExpression(stmt.expression, ts, checker);
  }

  return false;
}

/**
 * Checks if a node contains an unhandled throw or await (not wrapped in an inner try-catch).
 */
function containsUncaughtAwaitOrThrow(node: tsType.Node, ts: typeof tsType): boolean {
  let found = false;
  function walk(n: tsType.Node) {
    if (found) return;
    // Stop at nested function boundaries
    if (
      n !== node &&
      (ts.isFunctionDeclaration(n) ||
        ts.isArrowFunction(n) ||
        ts.isFunctionExpression(n) ||
        ts.isMethodDeclaration(n))
    ) {
      return;
    }

    if (ts.isThrowStatement(n)) {
      found = true;
      return;
    }

    if (ts.isAwaitExpression(n)) {
      found = true;
      return;
    }

    if (ts.isTryStatement(n)) {
      // If try has no catch clause, its tryBlock can propagate rejections!
      if (!n.catchClause) {
        if (containsAwaitOrThrow(n.tryBlock, ts)) {
          found = true;
          return;
        }
      } else {
        // Has catch clause: check catch block for uncaught throw/await
        if (containsUncaughtAwaitOrThrow(n.catchClause.block, ts)) {
          found = true;
          return;
        }
      }
      if (n.finallyBlock && containsUncaughtAwaitOrThrow(n.finallyBlock, ts)) {
        found = true;
        return;
      }
      return;
    }

    n.forEachChild(walk);
  }
  walk(node);
  return found;
}

/**
 * Analyzes the body of an async function to determine its rejection-handling behavior.
 */
function analyzeAsyncFunctionBody(
  body: tsType.Node,
  context: FunctionSummaryContext
): PromiseBehavior {
  const { ts, checker } = context;

  if (!ts.isBlock(body)) {
    // Concise arrow body e.g. async () => 42
    if (isProvenNonThrowingExpression(body as tsType.Expression, ts, checker)) {
      return "handles-known-rejections";
    }
    return "propagates";
  }

  const statements = body.statements;
  if (statements.length === 0) {
    return "handles-known-rejections";
  }

  let hasUncaught = false;
  let hasTryWithCatch = false;

  for (const stmt of statements) {
    if (ts.isTryStatement(stmt)) {
      if (!stmt.catchClause) {
        // try...finally with no catch: awaits in tryBlock propagate!
        if (containsAwaitOrThrow(stmt.tryBlock, ts)) {
          hasUncaught = true;
        }
      } else {
        hasTryWithCatch = true;
        // catch block: check if it re-throws or has uncaught await
        if (containsUncaughtAwaitOrThrow(stmt.catchClause.block, ts)) {
          hasUncaught = true;
        }
      }
      if (stmt.finallyBlock && containsUncaughtAwaitOrThrow(stmt.finallyBlock, ts)) {
        hasUncaught = true;
      }
    } else {
      if (containsAwaitOrThrow(stmt, ts)) {
        hasUncaught = true;
      }
    }
  }

  if (hasUncaught) {
    return "propagates";
  }

  if (hasTryWithCatch) {
    return "handles-known-rejections";
  }

  // If there are no awaits and no throws anywhere in the body
  return "handles-known-rejections";
}

/**
 * Computes a function summary using the given context.
 */
function computeFunctionSummary(
  funcNode: tsType.Node,
  context: FunctionSummaryContext
): FunctionSummary {
  const { ts, checker } = context;
  let isAsync = false;
  let body: tsType.Node | undefined;
  let funcSymbol: tsType.Symbol | undefined;

  if (
    ts.isFunctionDeclaration(funcNode) ||
    ts.isArrowFunction(funcNode) ||
    ts.isFunctionExpression(funcNode) ||
    ts.isMethodDeclaration(funcNode)
  ) {
    isAsync = Boolean(funcNode.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword));
    body = funcNode.body;
    if (checker && "name" in funcNode && funcNode.name) {
      funcSymbol = checker.getSymbolAtLocation(funcNode.name);
    }
  }

  let returnsPromiseLike = isAsync;
  let returnsOptionalPromiseUnion = false;

  if (checker) {
    try {
      const type = checker.getTypeAtLocation(funcNode);
      const signatures = type.getCallSignatures();
      if (signatures.length > 0) {
        const retType = signatures[0]?.getReturnType();
        if (retType) {
          if (isPromiseLike(retType, checker)) {
            returnsPromiseLike = true;
          }
          if (retType.isUnion()) {
            const hasVoid = retType.types.some((t) => (t.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) !== 0);
            const hasPromise = retType.types.some((t) => isPromiseLike(t, checker));
            if (hasVoid && hasPromise) {
              returnsOptionalPromiseUnion = true;
            }
          }
        }
      }
    } catch {
      // Fall back to syntactic flags
    }
  }

  let promiseBehavior: PromiseBehavior = "unknown";
  let returnsCreatedPromise = false;

  if (body) {
    if (isAsync) {
      promiseBehavior = analyzeAsyncFunctionBody(body, context);
    } else if (returnsPromiseLike) {
      promiseBehavior = "propagates";
    }
  } else {
    promiseBehavior = "unknown";
  }
  // Check if function explicitly creates / returns a Promise
  if (body) {
    function walkReturns(n: tsType.Node) {
      if (returnsCreatedPromise) return;
      if (ts.isReturnStatement(n) && n.expression) {
        const unwrapped = unwrapExpression(n.expression, ts);
        if (ts.isCallExpression(unwrapped) || ts.isIdentifier(unwrapped) || ts.isNewExpression(unwrapped)) {
          returnsCreatedPromise = true;
        }
      }
      if (
        n !== body &&
        (ts.isFunctionDeclaration(n) ||
          ts.isArrowFunction(n) ||
          ts.isFunctionExpression(n) ||
          ts.isMethodDeclaration(n))
      ) {
        return;
      }
      n.forEachChild(walkReturns);
    }
    walkReturns(body);
  }

  return {
    symbol: funcSymbol,
    isAsync,
    returnsPromiseLike,
    returnsOptionalPromiseUnion,
    promiseBehavior,
    returnsCreatedPromise,
  };
}

const summaryContextCache = new WeakMap<tsType.TypeChecker, FunctionSummaryContext>();

/**
 * Public helper to obtain a function summary (creates or reuses a context).
 */
export function getFunctionSummary(
  funcNode: tsType.Node,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined,
  context?: FunctionSummaryContext | undefined
): FunctionSummary {
  if (context) {
    return context.getSummary(funcNode);
  }

  if (checker) {
    let ctx = summaryContextCache.get(checker);
    if (!ctx) {
      ctx = new FunctionSummaryContext(ts, checker);
      summaryContextCache.set(checker, ctx);
    }
    return ctx.getSummary(funcNode);
  }

  const ctx = new FunctionSummaryContext(ts, checker);
  return ctx.getSummary(funcNode);
}
/**
 * Resolves a function node from a variable initializer or hook wrapper (e.g. useCallback(fn)).
 */
function resolveFunctionFromInitializer(
  init: tsType.Expression,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): tsType.Node | undefined {
  const unwrapped = unwrapExpression(init, ts);

  if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) {
    return unwrapped;
  }

  // useCallback(async () => ...)
  if (ts.isCallExpression(unwrapped)) {
    const callee = unwrapExpression(unwrapped.expression, ts);
    if (ts.isIdentifier(callee) && callee.text === "useCallback") {
      const cbArg = unwrapped.arguments[0];
      if (cbArg) {
        return resolveFunctionFromInitializer(cbArg, ts, checker);
      }
    }
  }

  return undefined;
}

/**
 * Resolves a CallExpression to its function declaration node.
 * Supports:
 * - Local identifiers
 * - Imported local project functions within the same TypeScript Program
 * - Ref-stored function calls (ref.current())
 * - useCallback wrappers
 * - Async IIFEs
 */
const resolvedDeclCache = new WeakMap<tsType.TypeChecker, WeakMap<tsType.Node, tsType.Node | null>>();

export function resolveLocalOrProjectFunctionDeclaration(
  callExpr: tsType.CallExpression,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): tsType.Node | undefined {
  if (checker) {
    let checkerMap = resolvedDeclCache.get(checker);
    if (!checkerMap) {
      checkerMap = new WeakMap<tsType.Node, tsType.Node | null>();
      resolvedDeclCache.set(checker, checkerMap);
    }
    const cached = checkerMap.get(callExpr);
    if (cached !== undefined) {
      return cached ?? undefined;
    }
    const result = computeResolveLocalOrProjectFunctionDeclaration(callExpr, ts, checker);
    checkerMap.set(callExpr, result ?? null);
    return result;
  }
  return computeResolveLocalOrProjectFunctionDeclaration(callExpr, ts, checker);
}

function computeResolveLocalOrProjectFunctionDeclaration(
  callExpr: tsType.CallExpression,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): tsType.Node | undefined {
  const callee = unwrapExpression(callExpr.expression, ts);

  // 1. Direct identifier call: checkPauseStatus() or imported local function
  if (ts.isIdentifier(callee)) {
    if (checker) {
      const sym = checker.getSymbolAtLocation(callee);
      if (sym) {
        let targetSym: tsType.Symbol | undefined = sym;
        if (targetSym.flags & ts.SymbolFlags.Alias) {
          try {
            targetSym = checker.getAliasedSymbol(targetSym);
          } catch {
            // ignore
          }
        }
        const decl = targetSym?.valueDeclaration ?? targetSym?.declarations?.[0];
        if (decl) {
          // Verify declaration is within local project (not node_modules or ambient d.ts)
          const fileName = decl.getSourceFile().fileName.replace(/\\/g, "/");
          if (fileName.includes("/node_modules/") || fileName.endsWith(".d.ts")) {
            return undefined;
          }

          if (
            ts.isFunctionDeclaration(decl) ||
            ts.isArrowFunction(decl) ||
            ts.isFunctionExpression(decl)
          ) {
            return decl;
          }
          if (ts.isVariableDeclaration(decl) && decl.initializer) {
            const resolved = resolveFunctionFromInitializer(decl.initializer, ts, checker);
            if (resolved) return resolved;
          }
        }
      }
    }
  }

  // 2. Ref-stored function call: detectDataMismatchRef.current()
  if (ts.isPropertyAccessExpression(callee) && callee.name.text === "current") {
    const refExpr = unwrapExpression(callee.expression, ts);
    if (ts.isIdentifier(refExpr) && checker) {
      const sym = checker.getSymbolAtLocation(refExpr);
      const decl = sym?.valueDeclaration ?? sym?.declarations?.[0];
      if (decl && ts.isVariableDeclaration(decl) && decl.initializer) {
        const init = unwrapExpression(decl.initializer, ts);
        if (ts.isCallExpression(init)) {
          const initCallee = unwrapExpression(init.expression, ts);
          if (ts.isIdentifier(initCallee) && initCallee.text === "useRef") {
            const refArg = init.arguments[0];
            if (refArg) {
              if (ts.isIdentifier(refArg)) {
                const targetSym = checker.getSymbolAtLocation(refArg);
                let resolvedSym = targetSym;
                if (resolvedSym && (resolvedSym.flags & ts.SymbolFlags.Alias)) {
                  try {
                    resolvedSym = checker.getAliasedSymbol(resolvedSym);
                  } catch {
                    // ignore
                  }
                }
                const targetDecl = resolvedSym?.valueDeclaration ?? resolvedSym?.declarations?.[0];
                if (targetDecl) {
                  if (ts.isVariableDeclaration(targetDecl) && targetDecl.initializer) {
                    const resolved = resolveFunctionFromInitializer(targetDecl.initializer, ts, checker);
                    if (resolved) return resolved;
                  }
                  if (
                    ts.isFunctionDeclaration(targetDecl) ||
                    ts.isArrowFunction(targetDecl) ||
                    ts.isFunctionExpression(targetDecl)
                  ) {
                    return targetDecl;
                  }
                }
              } else {
                const resolved = resolveFunctionFromInitializer(refArg, ts, checker);
                if (resolved) return resolved;
              }
            }
          }
        }
      }
    }
  }

  // 3. Immediately Invoked Async Function Expression (IIFE): (async () => { ... })()
  if (ts.isArrowFunction(callee) || ts.isFunctionExpression(callee)) {
    return callee;
  }

  return undefined;
}
