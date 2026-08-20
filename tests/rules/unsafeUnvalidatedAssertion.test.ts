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

  test("calibrates JSON.parse assertion inside try/catch to warning and medium confidence", () => {
    const code = `
interface MasteryState {
  attempts: Record<string, { score: number }>;
}

function getScore(raw: string, slug: string): number {
  try {
    const parsed = JSON.parse(raw) as MasteryState;
    return parsed.attempts[slug]?.score ?? 0;
  } catch {
    return 0;
  }
}
    `.trim();

    const findings = runRuleOnCode(unsafeUnvalidatedAssertionRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.severity, "warning");
    assert.equal(findings[0]?.confidence, "medium");
    assert.match(
      findings[0]?.message ?? "",
      /exceptions caught by local try\/catch/
    );
  });

  test("does not flag schema validation parsing on parsed JSON", () => {
    const code = `
interface User {
  id: string;
  name: string;
}
declare const userSchema: { parse(val: unknown): User };

function parseValidUser(payload: string): User {
  const raw = JSON.parse(payload);
  return userSchema.parse(raw);
}
    `.trim();

    const findings = runRuleOnCode(unsafeUnvalidatedAssertionRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag custom type guard validation on parsed JSON", () => {
    const code = `
interface User {
  id: string;
  name: string;
}
function isUser(val: unknown): val is User {
  return typeof val === 'object' && val !== null && 'id' in val && 'name' in val;
}

function parseUserWithGuard(payload: string): User | null {
  const parsed: unknown = JSON.parse(payload);
  if (isUser(parsed)) {
    return parsed;
  }
  return null;
}
    `.trim();

    const findings = runRuleOnCode(unsafeUnvalidatedAssertionRule, code);
    assert.equal(findings.length, 0);
  });
});
