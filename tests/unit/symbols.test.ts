import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { RuleRegistry } from "../../src/engine/registry.js";
import type { Rule } from "../../src/core/types.js";

describe("engine symbols helpers and rule registry", () => {
  test("rule registry handles registration, duplicate check, and category queries", () => {
    const registry = new RuleRegistry();

    const mockRuleA: Rule = {
      meta: {
        id: "async/async-foreach",
        category: "async",
        defaultSeverity: "error",
        defaultConfidence: "high",
        description: "test rule A",
        requiresTypeInformation: true,
      },
      analyze: () => {},
    };

    const mockRuleB: Rule = {
      meta: {
        id: "react/async-effect-callback",
        category: "react",
        defaultSeverity: "error",
        defaultConfidence: "high",
        description: "test rule B",
        requiresTypeInformation: true,
      },
      analyze: () => {},
    };

    registry.register(mockRuleA);
    registry.register(mockRuleB);

    assert.equal(registry.getAll().length, 2);
    assert.equal(registry.get("async/async-foreach"), mockRuleA);
    assert.deepEqual(registry.getByCategory("react"), [mockRuleB]);

    assert.throws(
      () => registry.register(mockRuleA),
      /Duplicate rule ID registered: 'async\/async-foreach'/
    );
  });
});
