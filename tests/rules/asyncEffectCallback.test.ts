import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { asyncEffectCallbackRule } from "../../src/rules/react/asyncEffectCallback.js";
import { runRuleOnCode } from "./ruleTestUtils.js";

describe("rule react/async-effect-callback", () => {
  test("flags direct async callback passed to useEffect", () => {
    const code = `
import { useEffect } from 'react';

function UserProfile() {
  useEffect(async () => {
    const res = await fetch('/api/user');
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(asyncEffectCallbackRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "react/async-effect-callback");
    assert.equal(findings[0]?.severity, "error");
    assert.equal(findings[0]?.confidence, "high");
  });

  test("does not flag inner async function called synchronously", () => {
    const code = `
import { useEffect } from 'react';

function UserProfile() {
  useEffect(() => {
    async function loadData() {
      await fetch('/api/user');
    }
    loadData();
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(asyncEffectCallbackRule, code);
    assert.equal(findings.length, 0);
  });
});
