import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fetchStatusUncheckedRule } from "../../src/rules/network/fetchStatusUnchecked.js";
import { runRuleOnCode } from "./ruleTestUtils.js";

describe("rule network/fetch-status-unchecked", () => {
  test("flags direct body consumption without checking response.ok or status", () => {
    const code = `
async function loadUserData(url: string) {
  const res = await fetch(url);
  const data = await res.json();
  return data;
}
    `.trim();

    const findings = runRuleOnCode(fetchStatusUncheckedRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "network/fetch-status-unchecked");
    assert.equal(findings[0]?.severity, "warning");
    assert.equal(findings[0]?.confidence, "high");
  });

  test("does not flag when response.ok is checked before consuming body", () => {
    const code = `
async function loadUserData(url: string) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('HTTP ' + res.status);
  }
  const data = await res.json();
  return data;
}
    `.trim();

    const findings = runRuleOnCode(fetchStatusUncheckedRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag when response.status is checked", () => {
    const code = `
async function loadUserData(url: string) {
  const res = await fetch(url);
  if (res.status === 200) {
    return await res.json();
  }
  return null;
}
    `.trim();

    const findings = runRuleOnCode(fetchStatusUncheckedRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag when fetch identifier is locally shadowed", () => {
    const code = `
function fetch(input: string): { json: () => Promise<unknown> } {
  return { json: async () => ({}) };
}

async function run() {
  const res = fetch('custom');
  const data = await res.json();
  return data;
}
    `.trim();

    const findings = runRuleOnCode(fetchStatusUncheckedRule, code);
    assert.equal(findings.length, 0);
  });
});
