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
  test("does not flag when response.ok positive branch encloses body consumption", () => {
    const code = `
async function loadUserData(url: string) {
  const res = await fetch(url);
  if (res.ok) {
    return await res.json();
  }
  return null;
}
    `.trim();

    const findings = runRuleOnCode(fetchStatusUncheckedRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag when ternary condition checks response.ok", () => {
    const code = `
async function loadUserData(url: string) {
  const res = await fetch(url);
  const data = res.ok ? await res.json() : null;
  return data;
}
    `.trim();

    const findings = runRuleOnCode(fetchStatusUncheckedRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag when switch statement on response.status guards body consumption", () => {
    const code = `
async function loadUserData(url: string) {
  const res = await fetch(url);
  switch (res.status) {
    case 200:
      return await res.json();
    default:
      return null;
  }
}
    `.trim();

    const findings = runRuleOnCode(fetchStatusUncheckedRule, code);
    assert.equal(findings.length, 0);
  });

  test("unsafe near-miss: flags when status check occurs AFTER body consumption", () => {
    const code = `
async function loadUserData(url: string) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    throw new Error('HTTP error');
  }
  return data;
}
    `.trim();

    const findings = runRuleOnCode(fetchStatusUncheckedRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "network/fetch-status-unchecked");
  });

  test("unsafe near-miss: flags when status is merely logged before body consumption without condition", () => {
    const code = `
async function loadUserData(url: string) {
  const res = await fetch(url);
  console.log(res.status);
  return await res.json();
}
    `.trim();

    const findings = runRuleOnCode(fetchStatusUncheckedRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "network/fetch-status-unchecked");
  });

  test("unsafe near-miss: flags when check is performed on a DIFFERENT response object", () => {
    const code = `
async function loadUserData(url1: string, url2: string) {
  const res1 = await fetch(url1);
  const res2 = await fetch(url2);
  if (!res2.ok) {
    throw new Error('res2 failed');
  }
  return await res1.json();
}
    `.trim();

    const findings = runRuleOnCode(fetchStatusUncheckedRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "network/fetch-status-unchecked");
  });

  test("unsafe near-miss: flags when status check is inside a non-dominating branch", () => {
    const code = `
async function loadUserData(url: string, shouldValidate: boolean) {
  const res = await fetch(url);
  if (shouldValidate) {
    if (!res.ok) {
      throw new Error('HTTP error');
    }
  }
  return await res.json();
}
    `.trim();

    const findings = runRuleOnCode(fetchStatusUncheckedRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "network/fetch-status-unchecked");
  });

  test("unsafe near-miss: flags when response variable is reassigned after status check", () => {
    const code = `
async function loadUserData(url1: string, url2: string) {
  let res = await fetch(url1);
  if (!res.ok) {
    throw new Error('HTTP error');
  }
  res = await fetch(url2);
  return await res.json();
}
    `.trim();

    const findings = runRuleOnCode(fetchStatusUncheckedRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "network/fetch-status-unchecked");
  });

  test("lookalike: custom object with ok/status properties is not treated as fetch Response", () => {
    const code = `
async function handleCustom() {
  const customObj = { ok: false, status: 500, json: async () => ({}) };
  const data = await customObj.json();
  return data;
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
