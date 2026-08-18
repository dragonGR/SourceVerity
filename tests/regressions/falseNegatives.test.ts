import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { nonNullAssertionRiskRule } from "../../src/rules/typescript/nonNullAssertionRisk.js";
import { derivedStateEffectRule } from "../../src/rules/react/derivedStateEffect.js";
import { floatingPromiseRule } from "../../src/rules/async/floatingPromise.js";
import { runRuleOnCode } from "../rules/ruleTestUtils.js";

describe("adversarial false-negative regression test suite", () => {
  // ── Task 1 & 15: Catch block that throws or re-throws ───────────────────────
  test("flags floating call when local async function catch block explicitly throws", () => {
    const code = `
async function loadData() {
  try {
    await Promise.resolve();
  } catch (err) {
    throw new Error("rethrow");
  }
}
function run() {
  loadData();
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "async/floating-promise");
    assert.equal(findings[0]?.severity, "error");
  });

  test("flags floating call when local async function catch block awaits a fallback", () => {
    const code = `
declare function fallback(): Promise<void>;
async function loadData() {
  try {
    await Promise.resolve();
  } catch (err) {
    await fallback();
  }
}
function run() {
  loadData();
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "async/floating-promise");
  });

  test("flags floating call when local async function catch block calls an unknown reporter", () => {
    const code = `
declare function unknownReporter(err: unknown): void;
async function loadData() {
  try {
    await Promise.resolve();
  } catch (err) {
    unknownReporter(err);
  }
}
function run() {
  loadData();
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "async/floating-promise");
  });

  test("flags floating call when local async function catch block returns Promise.reject", () => {
    const code = `
async function loadData() {
  try {
    await Promise.resolve();
  } catch (err) {
    return Promise.reject(new Error("failed"));
  }
}
function run() {
  loadData();
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "async/floating-promise");
  });

  // ── Task 16: Finally block in async functions ───────────────────────────────
  test("flags floating call when local async function finally block throws", () => {
    const code = `
async function loadData() {
  try {
    await Promise.resolve();
  } catch (err) {
    // empty
  } finally {
    throw new Error("finally error");
  }
}
function run() {
  loadData();
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "async/floating-promise");
  });

  test("flags floating call when local async function finally block awaits", () => {
    const code = `
declare function asyncCleanup(): Promise<void>;
async function loadData() {
  try {
    await Promise.resolve();
  } catch (err) {
    // empty
  } finally {
    await asyncCleanup();
  }
}
function run() {
  loadData();
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "async/floating-promise");
  });

  // ── Task 8: Promise assignment overwrite / escape analysis ──────────────────
  test("flags promise assignment when variable is overwritten with null before return", () => {
    const code = `
declare function loadResource(): Promise<string>;
function getResource() {
  let p: Promise<string> | null = loadResource();
  p = null;
  return "fallback";
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "async/floating-promise");
  });

  test("flags promise assignment when variable is overwritten with another promise before return", () => {
    const code = `
declare function loadFirst(): Promise<string>;
declare function loadSecond(): Promise<string>;
function getResource() {
  let cached = loadFirst();
  cached = loadSecond();
  return cached;
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "async/floating-promise");
  });

  test("does not flag promise assignment when returned through an alias chain", () => {
    const code = `
declare function loadResource(): Promise<string>;
function getResource() {
  const p = loadResource();
  const q = p;
  return q;
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 0);
  });

  // ── Task 3: TanStack Query throwOnError: true ───────────────────────────────
  test("flags TanStack query invalidation when throwOnError: true is configured", () => {
    const code = `
interface QueryClient {
  invalidateQueries(filters?: unknown, options?: { throwOnError?: boolean }): Promise<void>;
}
declare const queryClient: QueryClient;
function invalidate() {
  queryClient.invalidateQueries({ queryKey: ['users'] }, { throwOnError: true });
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "async/floating-promise");
  });

  // ── Task 4: Bare i18next init ───────────────────────────────────────────────
  test("flags bare i18next init call without callback, await, return, or catch", () => {
    const code = `
interface I18nInstance {
  init(options: Record<string, unknown>): Promise<unknown>;
}
declare const i18n: I18nInstance;
function setup() {
  i18n.init({ lng: 'en' });
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "async/floating-promise");
  });

  // ── Task 5: Custom fake navigate function ───────────────────────────────────
  test("flags custom user function named navigate that returns Promise<void>", () => {
    const code = `
function navigate(to: string): Promise<void> {
  return Promise.resolve();
}
function run() {
  navigate("/home");
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "async/floating-promise");
  });

  // ── Task 10: DEFAULT_* identifier resolving to dynamic value ────────────────
  test("flags useEffect state setter when DEFAULT_* identifier resolves to dynamic prop value", () => {
    const code = `
import { useEffect, useState } from 'react';
function Profile({ currentUser }: { currentUser: { name: string } }) {
  const [user, setUser] = useState(currentUser);
  const DEFAULT_USER = currentUser;

  useEffect(() => {
    setUser(DEFAULT_USER);
  }, [currentUser]);

  return <div>{user.name}</div>;
}
    `.trim();
    const findings = runRuleOnCode(derivedStateEffectRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "react/derived-state-effect");
  });

  test("does not flag useEffect state setter when INITIAL_* identifier resolves to static primitive", () => {
    const code = `
import { useEffect, useState } from 'react';
const INITIAL_COUNT = 0;
function Counter({ trigger }: { trigger: boolean }) {
  const [count, setCount] = useState(INITIAL_COUNT);

  useEffect(() => {
    setCount(INITIAL_COUNT);
  }, [trigger]);

  return <div>{count}</div>;
}
    `.trim();
    const findings = runRuleOnCode(derivedStateEffectRule, code);
    assert.equal(findings.length, 0);
  });

  // ── Task 13: Mutually recursive async functions ─────────────────────────────
  test("does not stack-overflow on mutually recursive async functions and flags unhandled call", () => {
    const code = `
async function funcA(): Promise<void> {
  await funcB();
}
async function funcB(): Promise<void> {
  await funcA();
}
function run() {
  funcA();
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "async/floating-promise");
  });

  // ── Task 7: .finally() and .catch().finally() edge cases ───────────────────
  test("flags promise.then(success).finally(cleanup) without catch", () => {
    const code = `
declare function doWork(): Promise<string>;
function run() {
  doWork().then((val) => val.trim()).finally(() => console.log("done"));
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "async/floating-promise");
  });

  test("flags promise.catch(handler).then(onFulfilled) where then step can reject", () => {
    const code = `
declare function doWork(): Promise<string>;
function run() {
  doWork().catch((err) => "fallback").then((val) => val.toUpperCase());
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "async/floating-promise");
  });

  // ── Task 11: Unprovable bounds helper functions ─────────────────────────────
  test("flags non-null assertion with unprovable custom clamp helper", () => {
    const code = `
declare function clamp(val: number, min: number, max: number): number;
const ITEMS: (string | undefined)[] = ["a", "b", "c"];
function getItem(idx: number) {
  const safeIdx = clamp(idx, 0, ITEMS.length - 1);
  return ITEMS[safeIdx]!;
}
    `.trim();
    const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "typescript/non-null-assertion-risk");
  });

  // ── Task 17: Control-handle discrimination adversarial cases ────────────────
  test("flags custom cancelable thenable DangerousOperation called in statement position", () => {
    const code = `
interface DangerousOperation extends PromiseLike<void> {
  cancel(): void;
}
declare function start(): DangerousOperation;
function run() {
  start();
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "async/floating-promise");
  });

  test("flags custom abortable promise called in statement position", () => {
    const code = `
interface AbortablePromise<T> extends Promise<T> {
  abort(): void;
}
declare function fetchWithAbort(url: string): AbortablePromise<string>;
function run() {
  fetchWithAbort("/api/data");
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "async/floating-promise");
  });

  test("flags custom transaction promise with rollback method", () => {
    const code = `
interface DBTransaction extends Promise<void> {
  rollback(): Promise<void>;
}
declare function beginTx(): DBTransaction;
function run() {
  beginTx();
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "async/floating-promise");
  });

  test("flags caller when async function preamble performs property access on nullable value", () => {
    const code = `
interface Config {
  options?: { setting: string };
}
async function processConfig(config: Config) {
  const s = config.options.setting;
  try {
    await Promise.resolve(s);
  } catch (err) {
    console.error(err);
  }
}
function run(c: Config) {
  processConfig(c);
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "async/floating-promise");
  });
});
