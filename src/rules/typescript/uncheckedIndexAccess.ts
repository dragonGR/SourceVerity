import type * as tsType from "typescript";
import { getNodeSourceRange } from "../../engine/symbols.js";
import type { Rule, RuleContext } from "../../core/types.js";

function getLiteralIntegerIndex(expr: tsType.Expression, ts: typeof tsType): number | undefined {
  let unwrapped = expr;
  while (ts.isParenthesizedExpression(unwrapped)) {
    unwrapped = unwrapped.expression;
  }
  if (ts.isNumericLiteral(unwrapped)) {
    const val = Number(unwrapped.text);
    if (Number.isInteger(val) && val >= 0) {
      return val;
    }
  }
  if (ts.isStringLiteral(unwrapped)) {
    if (/^\d+$/.test(unwrapped.text)) {
      const val = Number(unwrapped.text);
      if (Number.isInteger(val) && val >= 0) {
        return val;
      }
    }
  }
  return undefined;
}

function isStaticallySafeTupleAccess(
  index: number,
  type: tsType.Type,
  checker: tsType.TypeChecker,
  ts: typeof tsType
): boolean {
  if (type.isUnion()) {
    return type.types.every((t) => isStaticallySafeTupleAccess(index, t, checker, ts));
  }

  if (!checker.isTupleType(type)) {
    return false;
  }

  // In TypeScript TypeChecker, TupleType target stores elementFlags
  // sourceverity-disable-next-line typescript/non-null-assertion-risk -- compiler internal property access guarded by isTupleType
  const target = (type as { target?: { elementFlags?: readonly number[] } }).target ?? (type as { elementFlags?: readonly number[] });
  const elementFlags = target.elementFlags;
  if (!elementFlags || index < 0 || index >= elementFlags.length) {
    return false;
  }

  const flag = elementFlags[index];
  if (flag === undefined) {
    return false;
  }

  // ts.ElementFlags: Required = 1, Optional = 2, Rest = 4, Variadic = 8
  const isRequired = (flag & 1) !== 0;
  const isOptionalOrRest = (flag & (2 | 4 | 8)) !== 0;

  return isRequired && !isOptionalOrRest;
}

function isStaticallySafeIndexAccess(
  argExpr: tsType.Expression,
  containerType: tsType.Type,
  checker: tsType.TypeChecker,
  ts: typeof tsType
): boolean {
  const index = getLiteralIntegerIndex(argExpr, ts);
  if (index === undefined) {
    return false;
  }
  return isStaticallySafeTupleAccess(index, containerType, checker, ts);
}

export const uncheckedIndexAccessRule: Rule = {
  meta: {
    id: "typescript/unchecked-index-access",
    category: "typescript",
    defaultSeverity: "warning",
    defaultConfidence: "medium",
    description: "Detects dynamic index accesses dereferenced without presence checks in loose compiler configurations.",
    requiresTypeInformation: true,
  },

  analyze(context: RuleContext): void {
    const { sourceFile, checker, program, ts } = context;
    if (!checker || !program || !ts) return;

    const compilerOpts = program.getCompilerOptions();
    // Only active when noUncheckedIndexedAccess is false or omitted
    if (compilerOpts.noUncheckedIndexedAccess) {
      return;
    }

    context.visitNodes((node: tsType.Node) => {
      // ElementAccessExpression: obj[key]
      if (!ts.isElementAccessExpression(node)) return;

      const parent = node.parent;
      if (!parent) return;

      // Check if element access is immediately dereferenced
      let isDereferenced = false;

      // Case 1: items[i].prop (PropertyAccessExpression where expression is node)
      if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
        // Exclude optional chaining: items[i]?.prop
        if (!parent.questionDotToken) {
          isDereferenced = true;
        }
      }

      // Case 2: items[i]() (CallExpression where expression is node)
      if (ts.isCallExpression(parent) && parent.expression === node) {
        if (!parent.questionDotToken) {
          isDereferenced = true;
        }
      }

      if (isDereferenced) {
        try {
          const containerType = checker.getTypeAtLocation(node.expression);

          // If the element access is proven statically safe (e.g. required fixed tuple index), do not report
          if (isStaticallySafeIndexAccess(node.argumentExpression, containerType, checker, ts)) {
            return;
          }

          // Check if container type is an Array, Tuple, or Record
          const isArrayOrRecord =
            checker.isArrayType(containerType) ||
            checker.isTupleType(containerType) ||
            containerType.getStringIndexType() !== undefined ||
            containerType.getNumberIndexType() !== undefined;

          if (isArrayOrRecord) {
            const range = getNodeSourceRange(node, sourceFile);
            context.report({
              ruleId: "typescript/unchecked-index-access",
              category: "typescript",
              severity: "warning",
              confidence: "medium",
              message: "Index access is dereferenced directly without verifying presence.",
              file: sourceFile.fileName,
              range,
              evidence: [
                {
                  message: "The repository configuration does not enable noUncheckedIndexedAccess, so out-of-bounds indexing returns undefined at runtime.",
                  range,
                },
              ],
              suggestedAction: "Use optional chaining (items[i]?.property) or guard with a presence check.",
              safeAutomaticFix: false,
              repositoryAccepted: true,
            });
          }
        } catch {
          // Ignore resolution failure
        }
      }
    });
  },
};
