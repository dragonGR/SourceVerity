import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { uncheckedIndexAccessRule } from "../../src/rules/typescript/uncheckedIndexAccess.js";
import { runRuleOnCode } from "./ruleTestUtils.js";

describe("rule typescript/unchecked-index-access", () => {
  test("flags dynamic array element dereferenced without optional chaining in loose config", () => {
    const code = `
interface Item {
  title: string;
}

function printFirst(items: Item[]) {
  console.log(items[0].title);
}
    `.trim();

    const findings = runRuleOnCode(uncheckedIndexAccessRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "typescript/unchecked-index-access");
    assert.equal(findings[0]?.confidence, "medium");
  });

  test("does not flag element access guarded with optional chaining", () => {
    const code = `
interface Item {
  title: string;
}

function printFirst(items: Item[]) {
  console.log(items[0]?.title);
}
    `.trim();

    const findings = runRuleOnCode(uncheckedIndexAccessRule, code);
    assert.equal(findings.length, 0);
  });
});
