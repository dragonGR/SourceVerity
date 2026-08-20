import type * as tsType from "typescript";
import { unwrapExpression, resolveConstantValue } from "./values.js";

export interface FrameworkHandlingResult {
  readonly isHandled: boolean;
  readonly isKnownRejecting?: boolean | undefined;
  readonly reason?: string | undefined;
}

/**
 * Checks if a property access or call argument contains `{ throwOnError: true }`.
 */
function hasThrowOnErrorOption(
  args: readonly tsType.Expression[],
  ts: typeof tsType,
  checker: tsType.TypeChecker
): boolean {
  for (const arg of args) {
    const unwrapped = unwrapExpression(arg, ts);
    if (ts.isObjectLiteralExpression(unwrapped)) {
      for (const prop of unwrapped.properties) {
        if (ts.isPropertyAssignment(prop)) {
          const propName = prop.name.getText();
          if (propName === "throwOnError") {
            const val = resolveConstantValue(prop.initializer, ts, checker);
            if (val.isStatic && val.kind === "boolean" && val.value === true) {
              return true;
            }
            if (prop.initializer.kind === ts.SyntaxKind.TrueKeyword) {
              return true;
            }
          }
        }
      }
    }
  }
  return false;
}

/**
 * Checks if an argument expression represents a callable function or callback.
 */
function isCallableArgument(
  arg: tsType.Expression,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): boolean {
  const unwrapped = unwrapExpression(arg, ts);
  if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) {
    return true;
  }
  if (checker) {
    try {
      const type = checker.getTypeAtLocation(unwrapped);
      if (type.getCallSignatures().length > 0) {
        return true;
      }
    } catch {
      // ignore
    }
  }
  return false;
}
/**
 * Determines whether a declaration originates from an authentic React Router / Remix package or import.
 */
function isReactRouterDeclaration(decl: tsType.Declaration): boolean {
  const fileName = decl.getSourceFile().fileName.replace(/\\/g, "/");
  if (
    fileName.includes("react-router/") ||
    fileName.includes("react-router-dom/") ||
    fileName.includes("@remix-run/router/") ||
    fileName.includes("react-router-native/") ||
    fileName.includes("@types/react-router/") ||
    fileName.includes("@types/react-router-dom/")
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
      typeof current.moduleSpecifier.text === "string"
    ) {
      const mod = current.moduleSpecifier.text;
      if (
        mod === "react-router" ||
        mod === "react-router-dom" ||
        mod === "@remix-run/router" ||
        mod === "react-router-native"
      ) {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}


/**
 * Evaluates whether a CallExpression represents a verified, handled framework API call.
 */
export function evaluateFrameworkPromiseCall(
  callExpr: tsType.CallExpression,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): FrameworkHandlingResult {
  if (!checker) return { isHandled: false };

  const callee = unwrapExpression(callExpr.expression, ts);
  let targetIdentifier: tsType.Node | undefined;
  let methodName = "";

  if (ts.isPropertyAccessExpression(callee)) {
    targetIdentifier = callee.name;
    methodName = callee.name.text;
  } else if (ts.isIdentifier(callee)) {
    targetIdentifier = callee;
    methodName = callee.text;
  }

  if (!targetIdentifier) return { isHandled: false };

  const symbol = checker.getSymbolAtLocation(targetIdentifier);
  if (!symbol) return { isHandled: false };

  let targetSymbol: tsType.Symbol | undefined = symbol;
  if (targetSymbol.flags & ts.SymbolFlags.Alias) {
    try {
      targetSymbol = checker.getAliasedSymbol(targetSymbol);
    } catch {
      // ignore
    }
  }

  const declarations = [...(targetSymbol?.getDeclarations() ?? [])];

  // If target is a variable initialized by a function call (e.g. const goto = useNavigate()),
  // also collect declarations from the initializer's callee symbol
  if (targetSymbol?.valueDeclaration && ts.isVariableDeclaration(targetSymbol.valueDeclaration) && targetSymbol.valueDeclaration.initializer) {
    const initExpr = unwrapExpression(targetSymbol.valueDeclaration.initializer, ts);
    if (ts.isCallExpression(initExpr)) {
      const initCallee = unwrapExpression(initExpr.expression, ts);
      const initSym = checker.getSymbolAtLocation(initCallee);
      let resolvedInitSym = initSym;
      if (resolvedInitSym && (resolvedInitSym.flags & ts.SymbolFlags.Alias)) {
        try {
          resolvedInitSym = checker.getAliasedSymbol(resolvedInitSym);
        } catch {
          // ignore
        }
      }
      const initDecls = resolvedInitSym?.getDeclarations() ?? initSym?.getDeclarations();
      if (initDecls) {
        declarations.push(...initDecls);
      }
    }
  }

  // Also collect declarations from the type of the callee/target (e.g. NavigateFunction)
  try {
    const typeAtLoc = checker.getTypeAtLocation(targetIdentifier);
    const typeSymbols: tsType.Symbol[] = [];
    const mainSym = typeAtLoc.getSymbol();
    if (mainSym) typeSymbols.push(mainSym);
    const aliasSym = typeAtLoc.aliasSymbol;
    if (aliasSym) typeSymbols.push(aliasSym);
    if (typeAtLoc.isUnion()) {
      for (const member of typeAtLoc.types) {
        const mSym = member.getSymbol();
        if (mSym) typeSymbols.push(mSym);
        const mAlias = member.aliasSymbol;
        if (mAlias) typeSymbols.push(mAlias);
      }
    }
    for (const typeSymbol of typeSymbols) {
      let resolvedTypeSymbol: tsType.Symbol | undefined = typeSymbol;
      if (resolvedTypeSymbol.flags & ts.SymbolFlags.Alias) {
        try {
          resolvedTypeSymbol = checker.getAliasedSymbol(resolvedTypeSymbol);
        } catch {
          // ignore
        }
      }
      const typeDecls = resolvedTypeSymbol?.getDeclarations();
      if (typeDecls) {
        declarations.push(...typeDecls);
      }
    }
  } catch {
    // ignore
  }

  if (declarations.length === 0) return { isHandled: false };

  for (const decl of declarations) {
    const fileName = decl.getSourceFile().fileName.replace(/\\/g, "/");

    // 1. TanStack Query / React Query: invalidateQueries, resetQueries, cancelQueries, removeQueries, refetchQueries
    if (
      fileName.includes("@tanstack/query-core") ||
      fileName.includes("@tanstack/react-query") ||
      fileName.includes("react-query/")
    ) {
      if (
        methodName === "invalidateQueries" ||
        methodName === "resetQueries" ||
        methodName === "cancelQueries" ||
        methodName === "removeQueries" ||
        methodName === "refetchQueries" ||
        methodName === "setQueryData"
      ) {
        // If throwOnError: true is explicitly specified, the returned Promise will reject on query failure!
        if (hasThrowOnErrorOption(callExpr.arguments, ts, checker)) {
          return {
            isHandled: false,
            reason: "QueryClient method configured with throwOnError: true may reject unhandled.",
          };
        }

        return {
          isHandled: true,
          reason: "TanStack Query default query management handles failures internally without unhandled rejection.",
        };
      }
    }

    // 2. i18next: i18n.init(...)
    const isI18next =
      fileName.includes("i18next/") ||
      fileName.includes("i18next") ||
      (decl.parent &&
        (ts.isInterfaceDeclaration(decl.parent) || ts.isTypeAliasDeclaration(decl.parent)) &&
        /^(i18n|i18next|I18n|I18nInstance)$/i.test(decl.parent.name.text));

    if (isI18next) {
      if (methodName === "init") {
        // i18next init has two callback signatures:
        // 1. i18n.init(callback) -> 1 argument where arg[0] is callable
        // 2. i18n.init(options, callback) -> 2 arguments where arg[1] is callable
        const args = callExpr.arguments;
        const hasCallback =
          (args.length === 1 && args[0] !== undefined && isCallableArgument(args[0], ts, checker)) ||
          (args.length >= 2 && args[1] !== undefined && isCallableArgument(args[1], ts, checker));

        if (hasCallback) {
          return {
            isHandled: true,
            reason: "i18next init called with error/completion callback handler.",
          };
        }
        // Bare i18n.init(options) returns a Promise that can reject on init failure; must not be blanket-suppressed
        return {
          isHandled: false,
          isKnownRejecting: true,
          reason: "i18next 'init' returns a Promise that rejects on initialization failure, which will escape unhandled if not caught.",
        };
      }
    }

    // 3. React Hook Form: UseFormRegisterReturn.onChange / onBlur or ChangeHandler
    if (fileName.includes("react-hook-form/")) {
      if (
        methodName === "onChange" ||
        methodName === "onBlur" ||
        targetSymbol.name === "ChangeHandler"
      ) {
        return {
          isHandled: true,
          reason: "React Hook Form synthetic change handler handles internal async validation safely.",
        };
      }
    }

    // 4. React Router / Remix: NavigateFunction
    if (isReactRouterDeclaration(decl)) {
      const declNamed = decl as { name?: { text?: string } };
      const declName = declNamed.name?.text ?? "";
      const isNavigateContract =
        declName === "NavigateFunction" ||
        declName === "useNavigate" ||
        declName === "navigate" ||
        (ts.isInterfaceDeclaration(decl) && decl.name.text === "NavigateFunction") ||
        (ts.isTypeAliasDeclaration(decl) && decl.name.text === "NavigateFunction") ||
        (ts.isFunctionDeclaration(decl) && decl.name?.text === "useNavigate") ||
        methodName === "navigate" ||
        targetSymbol?.name === "NavigateFunction";

      if (isNavigateContract) {
        return {
          isHandled: true,
          reason: "React Router NavigateFunction optional navigation contract.",
        };
      }
    }
    if (
      fileName.includes("node:test") ||
      fileName.includes("@types/node/test.d.ts") ||
      fileName.includes("node/test.d.ts") ||
      fileName.endsWith("/node_modules/@types/node/test.d.ts")
    ) {
      if (
        methodName === "test" ||
        methodName === "describe" ||
        methodName === "it" ||
        methodName === "suite" ||
        methodName === "before" ||
        methodName === "after" ||
        methodName === "beforeEach" ||
        methodName === "afterEach" ||
        methodName === "only" ||
        methodName === "skip" ||
        methodName === "todo" ||
        targetSymbol.name === "test" ||
        targetSymbol.name === "describe" ||
        targetSymbol.name === "suite" ||
        targetSymbol.name === "it" ||
        targetSymbol.name === "TestFn" ||
        targetSymbol.name === "SuiteFn"
      ) {
        return {
          isHandled: true,
          reason: "Node test runner registration API executes test suite lifecycles without unhandled floating promise risk.",
        };
      }
    }

    // 6. Anime.js: animate, createTimer, JSAnimation, Timer, Timeline
    if (
      fileName.includes("animejs/") ||
      fileName.includes("node_modules/animejs/")
    ) {
      if (
        methodName === "animate" ||
        methodName === "createTimer" ||
        methodName === "createTimeline" ||
        methodName === "play" ||
        methodName === "pause" ||
        methodName === "restart" ||
        methodName === "revert" ||
        methodName === "seek" ||
        methodName === "cancel" ||
        methodName === "refresh" ||
        methodName === "stretch" ||
        targetSymbol.name === "animate" ||
        targetSymbol.name === "createTimer" ||
        targetSymbol.name === "JSAnimation" ||
        targetSymbol.name === "Timer" ||
        targetSymbol.name === "Timeline"
      ) {
        return {
          isHandled: true,
          reason: "Anime.js animation controller thenable handles lifecycle and completion internally without unhandled rejection.",
        };
      }
    }
  }

  return { isHandled: false };
}
