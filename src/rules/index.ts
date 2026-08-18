import { globalRuleRegistry } from "../engine/registry.js";
import { asyncForeachRule } from "./async/asyncForeach.js";
import { floatingPromiseRule } from "./async/floatingPromise.js";
import { unsafeUnvalidatedAssertionRule } from "./typescript/unsafeUnvalidatedAssertion.js";
import { nonNullAssertionRiskRule } from "./typescript/nonNullAssertionRisk.js";
import { uncheckedIndexAccessRule } from "./typescript/uncheckedIndexAccess.js";
import { fetchStatusUncheckedRule } from "./network/fetchStatusUnchecked.js";
import { eventListenerCleanupRule } from "./browser/eventListenerCleanup.js";
import { timerCleanupRule } from "./browser/timerCleanup.js";
import { observerCleanupRule } from "./browser/observerCleanup.js";
import { asyncEffectCallbackRule } from "./react/asyncEffectCallback.js";
import { derivedStateEffectRule } from "./react/derivedStateEffect.js";
import { missingEffectCleanupRule } from "./react/missingEffectCleanup.js";

export const BUILTIN_RULES = [
  asyncForeachRule,
  floatingPromiseRule,
  unsafeUnvalidatedAssertionRule,
  nonNullAssertionRiskRule,
  uncheckedIndexAccessRule,
  fetchStatusUncheckedRule,
  eventListenerCleanupRule,
  timerCleanupRule,
  observerCleanupRule,
  asyncEffectCallbackRule,
  derivedStateEffectRule,
  missingEffectCleanupRule,
] as const;

/**
 * Registers all 12 built-in production rules into the global registry.
 */
export function registerBuiltinRules(): void {
  for (const rule of BUILTIN_RULES) {
    if (!globalRuleRegistry.get(rule.meta.id)) {
      globalRuleRegistry.register(rule);
    }
  }
}

// Auto-register built-ins on module load
registerBuiltinRules();

export {
  asyncForeachRule,
  floatingPromiseRule,
  unsafeUnvalidatedAssertionRule,
  nonNullAssertionRiskRule,
  uncheckedIndexAccessRule,
  fetchStatusUncheckedRule,
  eventListenerCleanupRule,
  timerCleanupRule,
  observerCleanupRule,
  asyncEffectCallbackRule,
  derivedStateEffectRule,
  missingEffectCleanupRule,
};
