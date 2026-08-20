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
  test("does not flag in-bounds literal index access on fixed-length tuple", () => {
    const code = `
function handleTuple(x: [string, number]) {
  const first = x[0].toLowerCase();
  const second = x[1].toFixed();
  return { first, second };
}
    `.trim();

    const findings = runRuleOnCode(uncheckedIndexAccessRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag in-bounds required index access on tuple union", () => {
    const code = `
function handleUnion(x: [string, number] | [string, boolean]) {
  const first = x[0].toLowerCase();
  return first;
}
    `.trim();

    const findings = runRuleOnCode(uncheckedIndexAccessRule, code);
    assert.equal(findings.length, 0);
  });

  test("unsafe twin: flags dynamic index access on fixed-length tuple", () => {
    const code = `
function handleTuple(x: [string, number], i: number) {
  console.log(x[i].toString());
}
    `.trim();

    const findings = runRuleOnCode(uncheckedIndexAccessRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "typescript/unchecked-index-access");
  });

  test("unsafe twin: flags optional tuple element access without check", () => {
    const code = `
function handleOptTuple(x: [string, number?]) {
  console.log(x[1].toFixed());
}
    `.trim();

    const findings = runRuleOnCode(uncheckedIndexAccessRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "typescript/unchecked-index-access");
  });

  test("unsafe twin: flags arbitrary rest element index on rest tuple", () => {
    const code = `
function handleRestTuple(x: [string, ...number[]]) {
  console.log(x[10].toFixed());
}
    `.trim();

    const findings = runRuleOnCode(uncheckedIndexAccessRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "typescript/unchecked-index-access");
  });

  test("unsafe twin: flags out-of-bounds literal index access on fixed tuple", () => {
    const code = `
function handleTuple(x: [string, number]) {
  // @ts-ignore
  console.log(x[2].toString());
}
    `.trim();

    const findings = runRuleOnCode(uncheckedIndexAccessRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "typescript/unchecked-index-access");
  });
});
