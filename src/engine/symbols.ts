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
 * Determines whether a TypeScript type is Promise-like (implements .then() or named Promise).
 */
export function isPromiseLike(type: tsType.Type | undefined, checker: tsType.TypeChecker): boolean {
  if (!type) return false;

  const symbol = type.getSymbol() ?? type.aliasSymbol;
  if (symbol && (symbol.name === "Promise" || symbol.name === "PromiseLike")) {
    return true;
  }

  // Check for .then property with call signatures
  const thenProp = checker.getPropertyOfType(type, "then");
  if (thenProp) {
    const thenDecl = thenProp.valueDeclaration ?? thenProp.declarations?.[0];
    if (thenDecl) {
      const thenType = checker.getTypeOfSymbolAtLocation(thenProp, thenDecl);
      if (thenType.getCallSignatures().length > 0) {
        return true;
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
    return fileName.includes("react/index.d.ts") || fileName.includes("@types/react/") || fileName.includes("react.d.ts");
  });
}
