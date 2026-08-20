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
 * (e.g. useEffect, useState, useMemo), supporting direct imports, namespace imports,
 * and aliased imports originating from React or @types/react.
 */
export function resolveReactHook(node: tsType.Node, checker: tsType.TypeChecker, hookName: string): boolean {
  let targetIdentifier: tsType.Node | undefined;

  // Case 1: React.useEffect(...) property access
  if ("expression" in node && node.expression && typeof node.expression === "object") {
    const callExpr = node.expression;
    if ("name" in callExpr && "expression" in callExpr) {
      const propName = callExpr.name;
      if (propName && typeof propName === "object" && "text" in propName && propName.text === hookName) {
        targetIdentifier = propName as unknown as tsType.Node;
      }
    } else {
      targetIdentifier = callExpr as unknown as tsType.Node;
    }
  } else {
    targetIdentifier = node;
  }

  if (!targetIdentifier) {
    return false;
  }

  const symbol = checker.getSymbolAtLocation(targetIdentifier);
  if (!symbol) {
    return false;
  }

  if (symbol.name === hookName && isReactSymbol(symbol)) {
    return true;
  }

  // Check alias symbol if aliased (import { useEffect as myEffect })
  try {
    const aliased = checker.getAliasedSymbol(symbol);
    if (aliased && aliased.name === hookName && isReactSymbol(aliased)) {
      return true;
    }
  } catch {
    // Not an aliased symbol
  }

  return false;
}

function isReactSymbol(symbol: tsType.Symbol): boolean {
  const declarations = symbol.getDeclarations();
  if (!declarations || declarations.length === 0) {
    return false;
  }

  return declarations.some((decl) => {
    const fileName = decl.getSourceFile().fileName.replace(/\\/g, "/");
    if (fileName.includes("react/index.d.ts") || fileName.includes("@types/react/") || fileName.includes("react.d.ts")) {
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
