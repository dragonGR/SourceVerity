import type * as tsType from "typescript";

export interface ResolvedConstantValue {
  readonly kind: "string" | "number" | "boolean" | "null" | "undefined" | "other";
  readonly value?: string | number | boolean | null | undefined;
  readonly isStatic: boolean;
}

/**
 * Strips parentheses, type assertions (as / <T>), and non-null assertions (!)
 * to reach the underlying semantic expression.
 */
export function unwrapExpression(expr: tsType.Expression, ts: typeof tsType): tsType.Expression {
  let current: tsType.Expression = expr;
  while (true) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
    } else if (ts.isAsExpression(current)) {
      current = current.expression;
    } else if (ts.isTypeAssertionExpression(current)) {
      current = current.expression;
    } else if (ts.isNonNullExpression(current)) {
      current = current.expression;
    } else {
      break;
    }
  }
  return current;
}

/**
 * Resolves an expression to a static constant value if statically determinable.
 */
export function resolveConstantValue(
  expr: tsType.Expression,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): ResolvedConstantValue {
  const unwrapped = unwrapExpression(expr, ts);

  // 1. String literal
  if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
    return { kind: "string", value: unwrapped.text, isStatic: true };
  }

  // 2. Numeric literal
  if (ts.isNumericLiteral(unwrapped)) {
    const num = Number(unwrapped.text);
    return { kind: "number", value: Number.isNaN(num) ? undefined : num, isStatic: true };
  }

  // 3. Boolean literals
  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) {
    return { kind: "boolean", value: true, isStatic: true };
  }
  if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) {
    return { kind: "boolean", value: false, isStatic: true };
  }

  // 4. Null & undefined
  if (unwrapped.kind === ts.SyntaxKind.NullKeyword) {
    return { kind: "null", value: null, isStatic: true };
  }
  if (
    unwrapped.kind === ts.SyntaxKind.UndefinedKeyword ||
    (ts.isIdentifier(unwrapped) && unwrapped.text === "undefined")
  ) {
    return { kind: "undefined", value: undefined, isStatic: true };
  }

  // 5. Unary expressions (e.g. -1, +0)
  if (ts.isPrefixUnaryExpression(unwrapped)) {
    if (unwrapped.operator === ts.SyntaxKind.MinusToken || unwrapped.operator === ts.SyntaxKind.PlusToken) {
      const operand = resolveConstantValue(unwrapped.operand, ts, checker);
      if (operand.kind === "number" && typeof operand.value === "number") {
        const val = unwrapped.operator === ts.SyntaxKind.MinusToken ? -operand.value : operand.value;
        return { kind: "number", value: val, isStatic: true };
      }
    }
  }

  // 6. Binary expressions with static operands (e.g. 1 + 1, "a" + "b")
  if (ts.isBinaryExpression(unwrapped)) {
    const left = resolveConstantValue(unwrapped.left, ts, checker);
    const right = resolveConstantValue(unwrapped.right, ts, checker);
    if (left.isStatic && right.isStatic) {
      if (unwrapped.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        if (left.kind === "string" || right.kind === "string") {
          return { kind: "string", value: `${left.value ?? ""}${right.value ?? ""}`, isStatic: true };
        }
        if (left.kind === "number" && right.kind === "number" && typeof left.value === "number" && typeof right.value === "number") {
          return { kind: "number", value: left.value + right.value, isStatic: true };
        }
      }
      if (unwrapped.operatorToken.kind === ts.SyntaxKind.MinusToken) {
        if (left.kind === "number" && right.kind === "number" && typeof left.value === "number" && typeof right.value === "number") {
          return { kind: "number", value: left.value - right.value, isStatic: true };
        }
      }
    }
  }

  // 7. Array literal
  if (ts.isArrayLiteralExpression(unwrapped)) {
    if (unwrapped.elements.length === 0) {
      return { kind: "other", isStatic: true };
    }
    const allStatic = unwrapped.elements.every((elem) => {
      return resolveConstantValue(elem, ts, checker).isStatic;
    });
    if (allStatic) {
      return { kind: "other", isStatic: true };
    }
  }

  // 8. Object literal
  if (ts.isObjectLiteralExpression(unwrapped)) {
    if (unwrapped.properties.length === 0) {
      return { kind: "other", isStatic: true };
    }
    const allStatic = unwrapped.properties.every((prop) => {
      if (ts.isPropertyAssignment(prop)) {
        return resolveConstantValue(prop.initializer, ts, checker).isStatic;
      }
      return false;
    });
    if (allStatic) {
      return { kind: "other", isStatic: true };
    }
  }

  // 9. Identifiers -> trace symbol declaration if checker is present
  if (ts.isIdentifier(unwrapped) && checker) {
    const symbol = checker.getSymbolAtLocation(unwrapped);
    if (symbol) {
      let targetSym: tsType.Symbol | undefined = symbol;
      if (targetSym.flags & ts.SymbolFlags.Alias) {
        try {
          targetSym = checker.getAliasedSymbol(targetSym);
        } catch {
          // ignore
        }
      }

      const visited = new Set<tsType.Symbol>();
      while (targetSym && !visited.has(targetSym)) {
        visited.add(targetSym);
        const decl = targetSym.valueDeclaration ?? targetSym.declarations?.[0];
        if (decl && ts.isVariableDeclaration(decl) && decl.initializer) {
          // Only trace const / immutable declarations
          const parentList = decl.parent;
          const isConst = parentList && ts.isVariableDeclarationList(parentList) && (parentList.flags & ts.NodeFlags.Const) !== 0;
          if (isConst) {
            const resolved = resolveConstantValue(decl.initializer, ts, checker);
            if (resolved.isStatic) {
              return resolved;
            }
          }
        }
        break;
      }

      // Check literal type from checker
      try {
        const type = checker.getTypeAtLocation(unwrapped);
        if (type.isStringLiteral()) {
          return { kind: "string", value: type.value, isStatic: true };
        }
        if (type.isNumberLiteral()) {
          return { kind: "number", value: type.value, isStatic: true };
        }
      } catch {
        // ignore
      }
    }
  }

  return { kind: "other", isStatic: false };
}

/**
 * Checks if an expression is a proven static reset value
 * (e.g. 0, -1, "", null, undefined, false, static empty/populated literal object/array,
 * or a const identifier resolving to a static constant value).
 *
 * NOTE: Does NOT rely on identifier naming heuristics.
 */
export function isResetValue(
  expr: tsType.Expression,
  ts: typeof tsType,
  checker?: tsType.TypeChecker | undefined
): boolean {
  const unwrapped = unwrapExpression(expr, ts);
  const resolved = resolveConstantValue(unwrapped, ts, checker);

  if (!resolved.isStatic) {
    return false;
  }

  if (resolved.kind === "number" && (resolved.value === 0 || resolved.value === -1)) {
    return true;
  }
  if (resolved.kind === "string" && resolved.value === "") {
    return true;
  }
  if (resolved.kind === "null" || resolved.kind === "undefined") {
    return true;
  }
  if (resolved.kind === "boolean" && resolved.value === false) {
    return true;
  }
  if (resolved.kind === "other") {
    return true;
  }

  return false;
}
