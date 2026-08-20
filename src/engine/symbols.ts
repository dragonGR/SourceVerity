import type * as tsType from "typescript";
import type { SourceRange } from "../core/types.js";

/**
 * Calculates 1-indexed source line and column coordinates for an AST node.
 */
export function getNodeSourceRange(node: tsType.Node, sourceFile: tsType.SourceFile): SourceRange {
  const startPos = node.getStart(sourceFile);
  const endPos = node.getEnd();

  const startLoc = sourceFile.getLineAndCharacterOfPosition(startPos);
  const endLoc = sourceFile.getLineAndCharacterOfPosition(endPos);

  return {
    start: {
      line: startLoc.line + 1,
      column: startLoc.character + 1,
    },
    end: {
      line: endLoc.line + 1,
      column: endLoc.character + 1,
    },
  };
}

/**
 * Checks whether a TypeScript type represents an active lifecycle controller or animation handle
 * (such as AnimationPlaybackControls from framer-motion/motion)
 * rather than a primary asynchronous Promise.
 *
 * Requirements:
 * - Symbol named AnimationPlaybackControls / AnimationControls / TweenControl, OR
 * - Originates from framer-motion / popmotion / @motionone / motion package declarations, OR
 * - Structural animation controller containing stop, play, and playback properties (pause, time, speed, currentTime, complete).
 *
 * NOTE: Individual methods like `cancel()`, `abort()`, `rollback()`, or `dispose()` on arbitrary
 * Promise-like objects DO NOT grant blanket immunity from unhandled floating promise analysis.
 */
export function isControlOrHandleType(type: tsType.Type | undefined, checker: tsType.TypeChecker): boolean {
  if (!type) return false;

  const symbol = type.getSymbol() ?? type.aliasSymbol;
  if (symbol) {
    const symName = symbol.name;
    if (
      symName === "AnimationPlaybackControls" ||
      symName === "AnimationControls" ||
      symName === "TweenControl"
    ) {
      return true;
    }

    const decls = symbol.getDeclarations();
    if (decls && decls.length > 0) {
      for (const decl of decls) {
        const fileName = decl.getSourceFile().fileName.replace(/\\/g, "/");
        if (
          fileName.includes("/node_modules/framer-motion/") ||
          fileName.includes("/node_modules/motion/") ||
          fileName.includes("/node_modules/popmotion/") ||
          fileName.includes("/node_modules/@motionone/")
        ) {
          return true;
        }
      }
    }
  }

  // Structural animation controller check: must exhibit multi-method playback control API
  const hasStop = Boolean(checker.getPropertyOfType(type, "stop"));
  const hasPlay = Boolean(checker.getPropertyOfType(type, "play"));
  const hasPause = Boolean(checker.getPropertyOfType(type, "pause"));
  const hasTime = Boolean(checker.getPropertyOfType(type, "time") || checker.getPropertyOfType(type, "currentTime"));
  const hasSpeed = Boolean(checker.getPropertyOfType(type, "speed"));
  const hasComplete = Boolean(checker.getPropertyOfType(type, "complete"));

  if (hasStop && (hasPlay || hasPause) && (hasTime || hasSpeed || hasComplete || (hasPlay && hasPause))) {
    return true;
  }

  return false;
}

const isPromiseLikeCache = new WeakMap<tsType.TypeChecker, WeakMap<tsType.Type, boolean>>();

/**
 * Determines whether a TypeScript type is Promise-like (implements .then() or named Promise).
 */
export function isPromiseLike(type: tsType.Type | undefined, checker: tsType.TypeChecker): boolean {
  if (!type) return false;

  let checkerCache = isPromiseLikeCache.get(checker);
  if (!checkerCache) {
    checkerCache = new WeakMap<tsType.Type, boolean>();
    isPromiseLikeCache.set(checker, checkerCache);
  }

  const cached = checkerCache.get(type);
  if (cached !== undefined) {
    return cached;
  }

  const result = computeIsPromiseLike(type, checker);
  checkerCache.set(type, result);
  return result;
}

function computeIsPromiseLike(type: tsType.Type, checker: tsType.TypeChecker): boolean {
  const symbol = type.getSymbol() ?? type.aliasSymbol;
  if (symbol && (symbol.name === "Promise" || symbol.name === "PromiseLike")) {
    if (isControlOrHandleType(type, checker)) {
      return false;
    }
    return true;
  }

  // If the type has lifecycle control methods (stop, pause, cancel, etc.), it's a control handle, not a bare Promise
  if (isControlOrHandleType(type, checker)) {
    return false;
  }

  // Check for .then property with call signatures returning a thenable/promise
  const thenProp = checker.getPropertyOfType(type, "then");
  if (thenProp) {
    const thenDecl = thenProp.valueDeclaration ?? thenProp.declarations?.[0];
    if (thenDecl) {
      const thenType = checker.getTypeOfSymbolAtLocation(thenProp, thenDecl);
      const signatures = thenType.getCallSignatures();
      if (signatures.length > 0) {
        const retType = signatures[0]?.getReturnType();
        if (retType) {
          // In Promise/A+, then() returns another thenable/Promise or any/unknown, not void/primitive
          const isNonThenableReturn = (retType.flags & (16384 | 8192 | 131072 | 4 | 8 | 16 | 65536)) !== 0;
          if (!isNonThenableReturn) {
            return true;
          }
        }
      }
    }
  }

  // Handle union types (e.g. Promise<T> | undefined)
  if (type.isUnion()) {
    return type.types.some((t) => isPromiseLike(t, checker));
  }

  return false;
}

/**
 * Verifies that an identifier refers to an authentic global DOM/browser API
 * declared in the standard library (e.g. lib.dom.d.ts), not a shadowed local symbol.
 */
export function isDOMGlobal(node: tsType.Node, checker: tsType.TypeChecker, globalName: string): boolean {
  const symbol = checker.getSymbolAtLocation(node);
  if (!symbol) {
    return false;
  }

  if (symbol.name !== globalName) {
    return false;
  }

  const declarations = symbol.getDeclarations();
  if (!declarations || declarations.length === 0) {
    return false;
  }

  // If any declaration is in user source code (not in standard TypeScript lib), it is user-defined/shadowed
  const isUserDefined = declarations.some((decl) => {
    const fileName = decl.getSourceFile().fileName.toLowerCase().replace(/\\/g, "/");
    const isStdLib =
      fileName.includes("lib.dom.d.ts") ||
      fileName.includes("lib.es") ||
      fileName.includes("lib.webworker.d.ts") ||
      fileName.includes("typescript/lib/");
    return !isStdLib;
  });

  if (isUserDefined) {
    return false;
  }

  return declarations.some((decl) => {
    const fileName = decl.getSourceFile().fileName.toLowerCase().replace(/\\/g, "/");
    return (
      fileName.includes("lib.dom.d.ts") ||
      fileName.includes("lib.es") ||
      fileName.includes("lib.webworker.d.ts") ||
      fileName.includes("typescript/lib/")
    );
  });
}

/**
 * Verifies that a target node is a standard DOM EventTarget, Window, Document, or HTMLElement
 * declared in standard TypeScript DOM definitions, rather than a custom user object/emitter.
 */
export function isDOMEventTarget(
  node: tsType.Node,
  checker: tsType.TypeChecker | undefined,
  ts: typeof tsType
): boolean {
  if (
    ts.isIdentifier(node) &&
    (node.text === "window" || node.text === "document" || node.text === "globalThis")
  ) {
    return true;
  }

  if (!checker) {
    return false;
  }

  try {
    const type = checker.getTypeAtLocation(node);
    const addEventListenerProp = checker.getPropertyOfType(type, "addEventListener");
    if (!addEventListenerProp) return false;

    const decls = addEventListenerProp.getDeclarations();
    if (!decls || decls.length === 0) return false;

    return decls.some((decl) => {
      const fileName = decl.getSourceFile().fileName.toLowerCase().replace(/\\/g, "/");
      return (
        fileName.includes("lib.dom.d.ts") ||
        fileName.includes("lib.dom.iterable.d.ts") ||
        fileName.includes("lib.webworker.d.ts") ||
        fileName.includes("typescript/lib/")
      );
    });
  } catch {
    return false;
  }
}

/**
 * Verifies that a node represents an authentic DOM AbortController instance
 * declared in standard TypeScript DOM definitions.
 */
export function isDOMAbortController(
  node: tsType.Node,
  checker: tsType.TypeChecker | undefined,
  ts: typeof tsType
): boolean {
  if (!checker) {
    return false;
  }

  try {
    const type = checker.getTypeAtLocation(node);
    const abortProp = checker.getPropertyOfType(type, "abort");
    const signalProp = checker.getPropertyOfType(type, "signal");
    if (!abortProp || !signalProp) return false;

    const decls = abortProp.getDeclarations();
    if (!decls || decls.length === 0) return false;

    return decls.some((decl) => {
      const fileName = decl.getSourceFile().fileName.toLowerCase().replace(/\\/g, "/");
      return (
        fileName.includes("lib.dom.d.ts") ||
        fileName.includes("lib.dom.iterable.d.ts") ||
        fileName.includes("lib.webworker.d.ts") ||
        fileName.includes("typescript/lib/")
      );
    });
  } catch {
    return false;
  }
}

/**
 * Resolves whether a function/call node corresponds to a standard React hook
 * (e.g. useEffect, useState, useMemo, useCallback, useRef), supporting direct imports,
 * namespace imports, and aliased imports originating from React or @types/react.
 *
 * A call matches hookName ONLY if the actual resolved React export equals hookName.
 */
interface PropertyAccessLikeNode extends tsType.Node {
  readonly expression: tsType.Node;
  readonly name: tsType.Node & { readonly text?: string };
}

interface CallLikeNode extends tsType.Node {
  readonly expression: tsType.Node;
  readonly arguments: tsType.NodeArray<tsType.Node>;
}

interface BinaryLikeNode extends tsType.Node {
  readonly right: tsType.Node;
  readonly operatorToken: tsType.Node;
}

function isPropertyAccessLike(node: tsType.Node): node is PropertyAccessLikeNode {
  return (
    "name" in node &&
    "expression" in node &&
    node.name !== undefined &&
    node.expression !== undefined &&
    typeof (node as { name?: unknown }).name === "object" &&
    (node as { name?: unknown }).name !== null &&
    !("arguments" in node)
  );
}

function isReactImportDeclaration(decl: tsType.Declaration): boolean {
  const fileName = decl.getSourceFile().fileName.replace(/\\/g, "/");
  if (
    fileName.includes("react/index.d.ts") ||
    fileName.includes("@types/react/") ||
    fileName.includes("react.d.ts") ||
    (fileName.includes("/react/") && fileName.endsWith(".d.ts"))
  ) {
    return true;
  }

  let current: tsType.Node | undefined = decl;
  while (current) {
    if (
      "moduleSpecifier" in current &&
      current.moduleSpecifier &&
      typeof current.moduleSpecifier === "object" &&
      "text" in current.moduleSpecifier &&
      ((current.moduleSpecifier as { text?: unknown }).text === "react" ||
        (current.moduleSpecifier as { text?: unknown }).text === "react-dom")
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function getReactExportName(symbol: tsType.Symbol, checker: tsType.TypeChecker): string | undefined {
  // 1. If symbol is an alias, try resolving the target symbol first
  if ((symbol.flags & 2097152) !== 0) {
    try {
      const aliased = checker.getAliasedSymbol(symbol);
      if (aliased && aliased !== symbol && isReactSymbol(aliased)) {
        return aliased.name;
      }
    } catch {
      // ignore
    }
  }

  // 2. Check declarations for ImportSpecifier where module is react
  const declarations = symbol.getDeclarations();
  if (declarations && declarations.length > 0) {
    for (const decl of declarations) {
      if (isReactImportDeclaration(decl)) {
        if ("propertyName" in decl && decl.propertyName && typeof decl.propertyName === "object" && "text" in decl.propertyName) {
          const propIdent = decl.propertyName as { text?: string };
          if (typeof propIdent.text === "string") {
            return propIdent.text;
          }
        }
        if ("name" in decl && decl.name && typeof decl.name === "object" && "text" in decl.name) {
          const nameIdent = decl.name as { text?: string };
          if (typeof nameIdent.text === "string") {
            return nameIdent.text;
          }
        }
      }
    }
  }

  // 3. Direct React symbol declaration
  if (isReactSymbol(symbol)) {
    return symbol.name;
  }

  return undefined;
}

export function resolveReactHook(node: tsType.Node, checker: tsType.TypeChecker, hookName: string): boolean {
  if (!node || !checker) return false;

  let current: tsType.Node = node;
  // If CallExpression, inspect its callee
  if ("arguments" in current && "expression" in current && (current as CallLikeNode).expression) {
    current = (current as CallLikeNode).expression;
  }

  // Unwrap parentheses, non-null assertions, type assertions, and sequence expressions
  while (current) {
    if (isPropertyAccessLike(current)) {
      break;
    }
    if ("expression" in current && (current as { readonly expression?: tsType.Node }).expression) {
      current = (current as { readonly expression: tsType.Node }).expression;
    } else if ("right" in current && "operatorToken" in current && (current as BinaryLikeNode).right) {
      current = (current as BinaryLikeNode).right;
    } else {
      break;
    }
  }

  if (!current) return false;

  // Case 1: Property access on React namespace (e.g. React.useEffect, React.useCallback)
  if (isPropertyAccessLike(current)) {
    const propName = current.name;
    const propText = propName.text;

    // If the accessed property name does not match the requested hookName, it cannot match
    if (propText !== hookName) {
      return false;
    }

    // Verify that either the receiver expression or the property symbol originates from React
    const receiverExpr = current.expression;
    const receiverSymbol = checker.getSymbolAtLocation(receiverExpr);
    if (receiverSymbol) {
      if (isReactSymbol(receiverSymbol)) {
        return true;
      }
      if ((receiverSymbol.flags & 2097152) !== 0) {
        try {
          const aliased = checker.getAliasedSymbol(receiverSymbol);
          if (aliased && isReactSymbol(aliased)) {
            return true;
          }
        } catch {
          // ignore
        }
      }
    }

    const propSymbol = checker.getSymbolAtLocation(propName) ?? checker.getSymbolAtLocation(current);
    if (propSymbol) {
      const exportName = getReactExportName(propSymbol, checker);
      if (exportName === hookName) {
        return true;
      }
    }

    return false;
  }

  // Case 2: Identifier or direct symbol (e.g. useEffect, useCallback, or aliased import like cb / effect)
  const symbol = checker.getSymbolAtLocation(current);
  if (!symbol) {
    return false;
  }

  const exportName = getReactExportName(symbol, checker);
  return exportName === hookName;
}

export function isReactSymbol(symbol: tsType.Symbol): boolean {
  const declarations = symbol.getDeclarations();
  if (!declarations || declarations.length === 0) {
    return false;
  }

  return declarations.some((decl) => {
    const fileName = decl.getSourceFile().fileName.replace(/\\/g, "/");
    if (
      fileName.includes("react/index.d.ts") ||
      fileName.includes("@types/react/") ||
      fileName.includes("react.d.ts") ||
      (fileName.includes("/react/") && fileName.endsWith(".d.ts"))
    ) {
      return true;
    }

    let current: tsType.Node | undefined = decl;
    while (current) {
      if (
        "moduleSpecifier" in current &&
        current.moduleSpecifier &&
        typeof current.moduleSpecifier === "object" &&
        "text" in current.moduleSpecifier &&
        (current.moduleSpecifier.text === "react" || current.moduleSpecifier.text === "react-dom")
      ) {
        return true;
      }
      current = current.parent;
    }

    return false;
  });
}

/**
 * Resolves whether a CallExpression is an authentic React lifecycle hook call (useEffect or useLayoutEffect).
 * When TypeChecker is available, uses semantic symbol resolution only.
 * When TypeChecker is unavailable, falls back to syntactic identification.
 */
export function isReactLifecycleHookCall(
  node: tsType.CallExpression,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): boolean {
  if (checker) {
    return resolveReactHook(node, checker, "useEffect") || resolveReactHook(node, checker, "useLayoutEffect");
  }

  // Syntactic fallback ONLY when TypeChecker is genuinely unavailable
  let callee: tsType.Expression = node.expression;
  while (ts.isParenthesizedExpression(callee)) {
    callee = callee.expression;
  }
  if (ts.isIdentifier(callee)) {
    return callee.text === "useEffect" || callee.text === "useLayoutEffect";
  }
  if (ts.isPropertyAccessExpression(callee)) {
    if (ts.isIdentifier(callee.name) && (callee.name.text === "useEffect" || callee.name.text === "useLayoutEffect")) {
      if (ts.isIdentifier(callee.expression) && (callee.expression.text === "React" || callee.expression.text === "ReactCurrentDispatcher")) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Helper to identify whether a declaration originates from a standard HTTP Response library
 * (DOM lib.dom.d.ts, undici, node-fetch, Cloudflare Workers, Node.js @types/node).
 */
export function isStandardResponseDeclaration(decl: tsType.Declaration): boolean {
  const fileName = decl.getSourceFile().fileName.toLowerCase().replace(/\\/g, "/");
  return (
    fileName.includes("lib.dom.d.ts") ||
    fileName.includes("lib.dom.iterable.d.ts") ||
    fileName.includes("lib.webworker.d.ts") ||
    fileName.includes("typescript/lib/") ||
    fileName.includes("@types/node/") ||
    fileName.includes("undici-types/") ||
    fileName.includes("node_modules/undici/") ||
    fileName.includes("node-fetch/") ||
    fileName.includes("@types/node-fetch/") ||
    fileName.includes("@cloudflare/workers-types/")
  );
}

/**
 * Verifies that a PropertyAccessExpression with method name .json() originates
 * from an authentic standard fetch Response object (e.g. DOM Response, undici, node-fetch, Cloudflare Worker),
 * and does not contain conflicting user-defined declaration origin (e.g. declaration merging or local class/interface).
 */
export function isFetchResponseMethod(
  callTarget: tsType.PropertyAccessExpression,
  checker: tsType.TypeChecker | undefined,
  ts: typeof tsType
): boolean {
  if (callTarget.name.text !== "json") {
    return false;
  }

  if (checker) {
    try {
      const receiverType = checker.getTypeAtLocation(callTarget.expression);
      const typesToCheck = receiverType.isUnion()
        ? receiverType.types.filter(
            (t) =>
              !(
                t.flags &
                (ts.TypeFlags.Null |
                  ts.TypeFlags.Undefined |
                  ts.TypeFlags.Void)
              )
          )
        : [receiverType];

      if (typesToCheck.length === 0) return false;

      for (const type of typesToCheck) {
        const jsonProp = checker.getPropertyOfType(type, "json");
        if (!jsonProp) return false;

        const jsonDecls = jsonProp.getDeclarations();
        if (!jsonDecls || jsonDecls.length === 0) return false;

        // Must NOT contain any user-defined declaration (e.g. local method or declaration merging)
        const hasUserDefinedJson = jsonDecls.some((d) => !isStandardResponseDeclaration(d));
        if (hasUserDefinedJson) {
          return false;
        }

        // Must have verified standard Response origin
        const hasStandardJson = jsonDecls.some(isStandardResponseDeclaration);
        if (!hasStandardJson) {
          return false;
        }

        // Also verify the receiver type's symbol declarations to ensure the type itself has no local/custom declaration
        const typeSymbol = type.getSymbol() ?? type.aliasSymbol;
        if (typeSymbol) {
          const typeDecls = typeSymbol.getDeclarations();
          if (typeDecls && typeDecls.length > 0) {
            const hasUserDefinedType = typeDecls.some((d) => !isStandardResponseDeclaration(d));
            if (hasUserDefinedType) {
              return false;
            }
            const hasStandardType = typeDecls.some(isStandardResponseDeclaration);
            if (!hasStandardType) {
              return false;
            }
          }
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  // Syntactic fallback when TypeChecker is unavailable:
  // Only accept expressions commonly named response/res or direct fetch calls
  let receiver: tsType.Expression = callTarget.expression;
  while (ts.isParenthesizedExpression(receiver) || ts.isAwaitExpression(receiver)) {
    receiver = receiver.expression;
  }
  if (ts.isIdentifier(receiver)) {
    return receiver.text === "response" || receiver.text === "res";
  }
  if (ts.isCallExpression(receiver)) {
    let callee: tsType.Expression = receiver.expression;
    while (ts.isParenthesizedExpression(callee)) {
      callee = callee.expression;
    }
    if (ts.isIdentifier(callee) && callee.text === "fetch") {
      return true;
    }
  }

  return false;
}
