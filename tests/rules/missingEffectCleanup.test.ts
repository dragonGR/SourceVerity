import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { missingEffectCleanupRule } from "../../src/rules/react/missingEffectCleanup.js";
import { runRuleOnCode } from "./ruleTestUtils.js";

describe("rule react/missing-effect-cleanup", () => {
  test("flags WebSocket instantiated in useEffect without cleanup function", () => {
    const code = `
import { useEffect } from 'react';

function LiveFeed() {
  useEffect(() => {
    const socket = new WebSocket('wss://example.com');
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(missingEffectCleanupRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "react/missing-effect-cleanup");
    assert.equal(findings[0]?.severity, "warning");
    assert.equal(findings[0]?.confidence, "high");
  });

  test("does not flag WebSocket when cleanup function is returned", () => {
    const code = `
import { useEffect } from 'react';

function LiveFeed() {
  useEffect(() => {
    const socket = new WebSocket('wss://example.com');
    return () => {
      socket.close();
    };
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(missingEffectCleanupRule, code);
    assert.equal(findings.length, 0);
  });
});
