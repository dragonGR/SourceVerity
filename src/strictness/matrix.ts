export interface StrictnessFlagDefinition {
  readonly name: string;
  readonly compilerKey: string;
  readonly description: string;
  readonly category: "strict-family" | "null-safety" | "index-safety" | "typing-rigor";
}

export const STRICTNESS_FLAGS: readonly StrictnessFlagDefinition[] = [
  {
    name: "strict",
    compilerKey: "strict",
    description: "Enables all strict type-checking options family.",
    category: "strict-family",
  },
  {
    name: "strictNullChecks",
    compilerKey: "strictNullChecks",
    description: "Considers null and undefined in type checks.",
    category: "null-safety",
  },
  {
    name: "noImplicitAny",
    compilerKey: "noImplicitAny",
    description: "Raises error on expressions and declarations with an implied any type.",
    category: "typing-rigor",
  },
  {
    name: "strictFunctionTypes",
    compilerKey: "strictFunctionTypes",
    description: "Enforces contravariant parameter checking on function types.",
    category: "typing-rigor",
  },
  {
    name: "strictBindCallApply",
    compilerKey: "strictBindCallApply",
    description: "Enforces strict type checks on bind, call, and apply methods.",
    category: "typing-rigor",
  },
  {
    name: "strictPropertyInitialization",
    compilerKey: "strictPropertyInitialization",
    description: "Ensures non-undefined class properties are initialized in the constructor.",
    category: "null-safety",
  },
  {
    name: "useUnknownInCatchVariables",
    compilerKey: "useUnknownInCatchVariables",
    description: "Types catch clause variables as unknown rather than any.",
    category: "typing-rigor",
  },
  {
    name: "noUncheckedIndexedAccess",
    compilerKey: "noUncheckedIndexedAccess",
    description: "Adds undefined to index signatures and array lookups.",
    category: "index-safety",
  },
  {
    name: "exactOptionalPropertyTypes",
    compilerKey: "exactOptionalPropertyTypes",
    description: "Differentiates optional properties from properties set to undefined.",
    category: "typing-rigor",
  },
  {
    name: "noImplicitOverride",
    compilerKey: "noImplicitOverride",
    description: "Requires override keyword on subclass overridden methods.",
    category: "typing-rigor",
  },
] as const;
