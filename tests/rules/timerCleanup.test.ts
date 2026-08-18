import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { timerCleanupRule } from "../../src/rules/browser/timerCleanup.js";
import { runRuleOnCode } from "./ruleTestUtils.js";

describe("rule browser/timer-cleanup", () => {
  test("flags setInterval without matching clearInterval in useEffect", () => {
    const code = `
import { useEffect } from 'react';

function TimerComponent() {
  useEffect(() => {
    const id = setInterval(() => {
      console.log('tick');
    }, 1000);
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(timerCleanupRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "browser/timer-cleanup");
    assert.equal(findings[0]?.severity, "error");
    assert.equal(findings[0]?.confidence, "high");
  });

  test("does not flag setInterval with matching clearInterval in cleanup", () => {
    const code = `
import { useEffect } from 'react';

function TimerComponent() {
  useEffect(() => {
    const id = setInterval(() => {
      console.log('tick');
    }, 1000);
    return () => clearInterval(id);
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(timerCleanupRule, code);
    assert.equal(findings.length, 0);
  });

  test("flags setTimeout without clearTimeout as warning", () => {
    const code = `
import { useEffect } from 'react';

function DelayComponent() {
  useEffect(() => {
    setTimeout(() => {
      console.log('delayed');
    }, 500);
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(timerCleanupRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.severity, "warning");
    assert.equal(findings[0]?.confidence, "medium");
  });
});
