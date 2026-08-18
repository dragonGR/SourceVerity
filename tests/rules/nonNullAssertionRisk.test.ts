import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { nonNullAssertionRiskRule } from "../../src/rules/typescript/nonNullAssertionRisk.js";
import { runRuleOnCode } from "./ruleTestUtils.js";

describe("rule typescript/non-null-assertion-risk", () => {
  test("flags non-null assertion on nullable union type", () => {
    const code = `
function getLength(str: string | null): number {
  return str!.length;
}
    `.trim();

    const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "typescript/non-null-assertion-risk");
    assert.equal(findings[0]?.severity, "warning");
    assert.equal(findings[0]?.confidence, "high");
  });

  test("flags non-null assertion on optional undefined property", () => {
    const code = `
interface Profile {
  nickname?: string;
}

function printNick(p: Profile) {
  console.log(p.nickname!.toUpperCase());
}
    `.trim();

    const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
    assert.equal(findings.length, 1);
  });

  test("does not flag non-null assertion on non-nullable type", () => {
    const code = `
function processName(name: string) {
  return name!.trim();
}
    `.trim();

    const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
    assert.equal(findings.length, 0);
  });
});
