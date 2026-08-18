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

    test("does not flag guarded array index access with offset (indexOf + bounds check)", () => {
      const code = `
  const ITEMS: (string | undefined)[] = ["a", "b", "c", "d", "e"];
  function getNext(value: string) {
    const index = ITEMS.indexOf(value);
    if (index === -1 || index >= ITEMS.length - 1) {
      return null;
    }
    const next = ITEMS[index + 1]!;
    return next;
  }
      `.trim();
  
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });
  
    test("flags unguarded array index access near-miss", () => {
      const code = `
  const ITEMS: (string | undefined)[] = ["a", "b", "c", "d", "e"];
  function getNext(value: string) {
    const index = ITEMS.indexOf(value);
    const next = ITEMS[index + 1]!;
    return next;
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });
  
    test("does not flag direct null guard before non-null assertion", () => {
      const code = `
  function printLength(value: string | null) {
    if (!value) return;
    console.log(value!.length);
  }
      `.trim();
  
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });
  });
