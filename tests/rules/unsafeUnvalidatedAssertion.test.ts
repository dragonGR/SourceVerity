import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { unsafeUnvalidatedAssertionRule } from "../../src/rules/typescript/unsafeUnvalidatedAssertion.js";
import { runRuleOnCode } from "./ruleTestUtils.js";

describe("rule typescript/unsafe-unvalidated-assertion", () => {
  test("flags JSON.parse asserted directly to domain interface", () => {
    const code = `
interface User {
  id: string;
  name: string;
}

function parseUser(payload: string): User {
  return JSON.parse(payload) as User;
}
    `.trim();

    const findings = runRuleOnCode(unsafeUnvalidatedAssertionRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "typescript/unsafe-unvalidated-assertion");
    assert.equal(findings[0]?.severity, "error");
    assert.equal(findings[0]?.confidence, "high");
  });

  test("flags response.json() asserted to domain type", () => {
    const code = `
interface ApiResponse {
  data: string[];
}

async function fetchData(res: Response): Promise<ApiResponse> {
  const body = (await res.json()) as ApiResponse;
  return body;
}
    `.trim();

    const findings = runRuleOnCode(unsafeUnvalidatedAssertionRule, code);
    assert.equal(findings.length, 1);
  });

  test("flags localStorage.getItem asserted to domain type", () => {
    const code = `
interface SessionData {
  token: string;
}

function getSession(): SessionData {
  return localStorage.getItem("session") as SessionData;
}
    `.trim();

    const findings = runRuleOnCode(unsafeUnvalidatedAssertionRule, code);
    assert.equal(findings.length, 1);
  });

  test("does not flag assertion to unknown or any", () => {
    const code = `
function parseRaw(payload: string): unknown {
  return JSON.parse(payload) as unknown;
}
    `.trim();

    const findings = runRuleOnCode(unsafeUnvalidatedAssertionRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag assertion on already validated local objects", () => {
    const code = `
interface Point { x: number; y: number; }
const raw = { x: 10, y: 20 };
const p = raw as Point;
    `.trim();

    const findings = runRuleOnCode(unsafeUnvalidatedAssertionRule, code);
    assert.equal(findings.length, 0);
  });
});
