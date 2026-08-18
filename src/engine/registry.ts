import type { Rule, RuleCategory } from "../core/types.js";

export class RuleRegistry {
  private readonly rulesById = new Map<string, Rule>();

  /**
   * Registers a new audit rule. Throws if a duplicate rule ID is registered.
   */
  register(rule: Rule): void {
    if (this.rulesById.has(rule.meta.id)) {
      throw new Error(`Duplicate rule ID registered: '${rule.meta.id}'`);
    }
    this.rulesById.set(rule.meta.id, rule);
  }

  /**
   * Retrieves a rule by its unique ID.
   */
  get(ruleId: string): Rule | undefined {
    return this.rulesById.get(ruleId);
  }

  /**
   * Returns all registered rules.
   */
  getAll(): readonly Rule[] {
    return Array.from(this.rulesById.values());
  }

  /**
   * Returns all rules matching a specific category.
   */
  getByCategory(category: RuleCategory): readonly Rule[] {
    return this.getAll().filter((rule) => rule.meta.category === category);
  }

  /**
   * Clears all registered rules (useful for test isolation).
   */
  clear(): void {
    this.rulesById.clear();
  }
}

export const globalRuleRegistry = new RuleRegistry();
