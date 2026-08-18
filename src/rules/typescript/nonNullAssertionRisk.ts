import type * as tsType from "typescript";
import { getNodeSourceRange } from "../../engine/symbols.js";
import { isGuardedNonNullAssertion } from "../../analysis/controlFlow.js";
import type { Rule, RuleContext } from "../../core/types.js";

/**
 * Checks if a type contains null or undefined in its flags or union members.
 */
function isNullableType(type: tsType.Type, ts: typeof tsType): boolean {
  if (type.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)) {
    return true;
  }
  if (type.isUnion()) {
    return type.types.some((t) => isNullableType(t, ts));
  }
  return false;
}

export const nonNullAssertionRiskRule: Rule = {
  meta: {
    id: "typescript/non-null-assertion-risk",
    category: "typescript",
    defaultSeverity: "warning",
    defaultConfidence: "high",
    description: "Detects non-null assertions on types that contain null or undefined.",
    requiresTypeInformation: true,
  },

  analyze(context: RuleContext): void {
    const { sourceFile, checker, ts } = context;
    if (!checker || !ts) return;

    context.visitNodes((node: tsType.Node) => {
      if (!ts.isNonNullExpression(node)) return;

      // 1. Conservative control-flow & bounds check
      const guardCheck = isGuardedNonNullAssertion(node, ts, checker);
      if (guardCheck.isGuarded) {
        return;
      }

      try {
        const innerType = checker.getTypeAtLocation(node.expression);
        if (isNullableType(innerType, ts)) {
          const range = getNodeSourceRange(node, sourceFile);
          context.report({
            ruleId: "typescript/non-null-assertion-risk",
            category: "typescript",
            severity: "warning",
            confidence: "high",
            message: "Non-null assertion on nullable type risks unhandled runtime TypeError.",
            file: sourceFile.fileName,
            range,
            evidence: [
              {
                message: "The operand type includes null or undefined at this location.",
                range,
              },
            ],
            suggestedAction: "Use optional chaining (?.), nullish coalescing (??), or an explicit presence guard.",
            safeAutomaticFix: false,
          });
        }
      } catch {
        // Ignore type resolution failures
      }
    });
  },
};
