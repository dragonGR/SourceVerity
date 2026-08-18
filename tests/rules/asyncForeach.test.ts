import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { asyncForeachRule } from "../../src/rules/async/asyncForeach.js";
import { runRuleOnCode } from "./ruleTestUtils.js";

describe("rule async/async-foreach", () => {
  test("flags direct async arrow function passed to forEach", () => {
    const code = `
const items = [1, 2, 3];
items.forEach(async (item) => {
  await fetch('/api/' + item);
});
    `.trim();

    const findings = runRuleOnCode(asyncForeachRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "async/async-foreach");
    assert.equal(findings[0]?.severity, "error");
    assert.equal(findings[0]?.confidence, "high");
  });

  test("flags async function expression passed to forEach", () => {
    const code = `
const list = ["a", "b"];
list.forEach(async function(item) {
  await Promise.resolve(item);
});
    `.trim();

    const findings = runRuleOnCode(asyncForeachRule, code);
    assert.equal(findings.length, 1);
  });

  test("does not flag synchronous forEach callback", () => {
    const code = `
const numbers = [1, 2, 3];
numbers.forEach((n) => {
  console.log(n * 2);
});
    `.trim();

    const findings = runRuleOnCode(asyncForeachRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag for..of loop with await", () => {
    const code = `
async function processItems(items: string[]) {
  for (const item of items) {
    await fetch(item);
  }
}
    `.trim();

    const findings = runRuleOnCode(asyncForeachRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag Promise.all with map", () => {
    const code = `
async function processItems(items: string[]) {
  await Promise.all(items.map(async (item) => {
    return await fetch(item);
  }));
}
    `.trim();

    const findings = runRuleOnCode(asyncForeachRule, code);
    assert.equal(findings.length, 0);
  });
});
