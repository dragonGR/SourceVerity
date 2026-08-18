import type * as tsType from "typescript";
import { getNodeSourceRange } from "../../engine/symbols.js";
import type { Rule, RuleContext } from "../../core/types.js";

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
