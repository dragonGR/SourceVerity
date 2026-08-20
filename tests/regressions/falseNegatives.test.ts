import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { nonNullAssertionRiskRule } from "../../src/rules/typescript/nonNullAssertionRisk.js";
import { derivedStateEffectRule } from "../../src/rules/react/derivedStateEffect.js";
import { floatingPromiseRule } from "../../src/rules/async/floatingPromise.js";
import { unsafeUnvalidatedAssertionRule } from "../../src/rules/typescript/unsafeUnvalidatedAssertion.js";
import { eventListenerCleanupRule } from "../../src/rules/browser/eventListenerCleanup.js";
import { missingEffectCleanupRule } from "../../src/rules/react/missingEffectCleanup.js";
import { fetchStatusUncheckedRule } from "../../src/rules/network/fetchStatusUnchecked.js";
import { uncheckedIndexAccessRule } from "../../src/rules/typescript/uncheckedIndexAccess.js";
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

  test("flags non-null assertion when variable is reassigned to nullable after dominating guard", () => {
    const code = `
interface User {
  name: string;
}
declare function getOtherUser(): User | null;
function test(user: User | null) {
  if (!user) return;
  user = getOtherUser();
  console.log(user!.name);
}
    `.trim();
    const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "typescript/non-null-assertion-risk");
  });

  test("flags promise assignment when alias is overwritten with null before return", () => {
    const code = `
declare function loadData(): Promise<string>;
function testFlow() {
  let p: Promise<string> | null = loadData();
  let q: Promise<string> | null = p;
  q = null;
  return q;
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "async/floating-promise");
  });

  test("flags copy[idx]! when copy is truncated by slice(0, 1) but index comes from full array", () => {
    const code = `
const prev: ({ name: string } | undefined)[] = [{ name: "a" }, { name: "b" }, { name: "c" }];
function testSlice() {
  let victimIdx = -1;
  for (let i = 0; i < prev.length; i++) {
    if (prev[i]?.name === "c") {
      victimIdx = i;
      break;
    }
  }
  if (victimIdx < 0) return null;
  const copy = prev.slice(0, 1);
  return copy[victimIdx]!;
}
    `.trim();
    const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "typescript/non-null-assertion-risk");
  });

  test("flags React state indexing when functional updater returns out-of-bounds literal", () => {
    const code = `
import { useState } from 'react';
const STEPS: ({ title: string } | undefined)[] = [
  { title: 'Step 1' },
  { title: 'Step 2' },
];
function Component() {
  const [step, setStep] = useState(0);
  const current = STEPS[step]!;
  const jump = () => setStep(s => 99999);
  return null;
}
    `.trim();
    const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "typescript/non-null-assertion-risk");
  });

  test("flags React state indexing when useState is a custom local function", () => {
    const code = `
function useState(init: number): [number, (val: number) => void] {
  return [init, (v) => {}];
}
const STEPS: ({ title: string } | undefined)[] = [
  { title: 'Step 1' },
  { title: 'Step 2' },
];
function Component() {
  const [step, setStep] = useState(0);
  const current = STEPS[step]!;
  const handleNext = () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    }
  };
  return null;
}
    `.trim();
    const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "typescript/non-null-assertion-risk");
  });

  test("flags caller when async function preamble throws synchronously on nullable property access", () => {
    const code = `
declare function work(): Promise<void>;
async function execute(input: { val?: string }) {
  const v = input.val.trim();
  try {
    await work();
  } catch (err) {
    console.error(err);
  }
}
function run(x: { val?: string }) {
  execute(x);
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "async/floating-promise");
    assert.equal(findings[0]?.severity, "error");
    assert.equal(findings[0]?.confidence, "high");
  });

  test("adversarial: flags fake local interface NavigateFunction when not from React Router", () => {
    const code = `
interface NavigateFunction {
  (to: string): Promise<void>;
}
declare const customNavigate: NavigateFunction;
const goto: NavigateFunction = customNavigate;
function run() {
  goto("/dashboard");
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "async/floating-promise");
  });

  test("adversarial: flags custom async function named goto", () => {
    const code = `
declare function risky(url: string): Promise<void>;
const goto = async (url: string) => {
  await risky(url);
};
function run() {
  goto("/dashboard");
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "async/floating-promise");
  });

  test("adversarial: does not flag customConverter.json() as response.json() boundary", () => {
    const code = `
interface DomainType {
  id: string;
}
class CustomConverter {
  json(): unknown {
    return { id: "test" };
  }
}
const customConverter = new CustomConverter();
const x = customConverter.json() as DomainType;
    `.trim();
    const findings = runRuleOnCode(unsafeUnvalidatedAssertionRule, code);
    assert.equal(findings.length, 0);
  });

  test("adversarial: does not flag local interface Response with json() method", () => {
    const code = `
interface User {
  id: string;
}
interface Response {
  json(): unknown;
}
declare const localObject: Response;
const response: Response = localObject;
const data = response.json() as User;
    `.trim();
    const findings = runRuleOnCode(unsafeUnvalidatedAssertionRule, code);
    assert.equal(findings.length, 0);
  });

  test("adversarial: does not flag listener inside local function named useEffect", () => {
    const code = `
function useEffect(cb: () => void) {
  cb();
}
function Component() {
  useEffect(() => {
    window.addEventListener('click', () => {});
  });
}
    `.trim();
    const findings = runRuleOnCode(eventListenerCleanupRule, code);
    assert.equal(findings.length, 0);
  });

  test("adversarial: does not flag listener inside local function named useLayoutEffect", () => {
    const code = `
function useLayoutEffect(cb: () => void) {
  cb();
}
function Component() {
  useLayoutEffect(() => {
    window.addEventListener('click', () => {});
  });
}
    `.trim();
    const findings = runRuleOnCode(eventListenerCleanupRule, code);
    assert.equal(findings.length, 0);
  });

  // ── Phase C Matrix: react/missing-effect-cleanup ───────────────────────────
  test("phase C matrix: flags unsafe return 42 as missing cleanup", () => {
    const code = `
import { useEffect } from 'react';
function LiveFeed() {
  useEffect(() => {
    const socket = new WebSocket('wss://example.com');
    return 42;
  }, []);
}
    `.trim();
    const findings = runRuleOnCode(missingEffectCleanupRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "react/missing-effect-cleanup");
  });

  test("phase C matrix: flags unsafe return socket as missing cleanup", () => {
    const code = `
import { useEffect } from 'react';
function LiveFeed() {
  useEffect(() => {
    const socket = new WebSocket('wss://example.com');
    return socket;
  }, []);
}
    `.trim();
    const findings = runRuleOnCode(missingEffectCleanupRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "react/missing-effect-cleanup");
  });

  test("phase C matrix: flags unsafe return of variable containing number", () => {
    const code = `
import { useEffect } from 'react';
function LiveFeed() {
  useEffect(() => {
    const socket = new WebSocket('wss://example.com');
    const val = 123;
    return val;
  }, []);
}
    `.trim();
    const findings = runRuleOnCode(missingEffectCleanupRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "react/missing-effect-cleanup");
  });

  test("phase C matrix: lookalike cleanup function satisfies presence contract", () => {
    const code = `
import { useEffect } from 'react';
function LiveFeed() {
  useEffect(() => {
    const socket = new WebSocket('wss://example.com');
    function cleanup() {
      console.log('unrelated action');
    }
    return cleanup;
  }, []);
}
    `.trim();
    const findings = runRuleOnCode(missingEffectCleanupRule, code);
    assert.equal(findings.length, 0);
  });

  // ── Phase C Matrix: network/fetch-status-unchecked ─────────────────────────
  test("phase C matrix: flags when status check occurs AFTER body consumption", () => {
    const code = `
async function load(url: string) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error();
  return data;
}
    `.trim();
    const findings = runRuleOnCode(fetchStatusUncheckedRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "network/fetch-status-unchecked");
  });

  test("phase C matrix: flags when status property is read without conditional guard", () => {
    const code = `
async function load(url: string) {
  const res = await fetch(url);
  console.log(res.status);
  return await res.json();
}
    `.trim();
    const findings = runRuleOnCode(fetchStatusUncheckedRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "network/fetch-status-unchecked");
  });

  test("phase C matrix: flags when check guards a different response object", () => {
    const code = `
async function load(u1: string, u2: string) {
  const r1 = await fetch(u1);
  const r2 = await fetch(u2);
  if (!r2.ok) throw new Error();
  return await r1.json();
}
    `.trim();
    const findings = runRuleOnCode(fetchStatusUncheckedRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "network/fetch-status-unchecked");
  });

  test("phase C matrix: flags when response variable is reassigned after status check", () => {
    const code = `
async function load(u1: string, u2: string) {
  let res = await fetch(u1);
  if (!res.ok) throw new Error();
  res = await fetch(u2);
  return await res.json();
}
    `.trim();
    const findings = runRuleOnCode(fetchStatusUncheckedRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "network/fetch-status-unchecked");
  });

  // ── Phase C Matrix: typescript/unchecked-index-access ──────────────────────
  test("phase C matrix: flags dynamic index access on fixed tuple", () => {
    const code = `
function testTuple(x: [string, number], i: number) {
  console.log(x[i].toString());
}
    `.trim();
    const findings = runRuleOnCode(uncheckedIndexAccessRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "typescript/unchecked-index-access");
  });

  test("phase C matrix: flags optional tuple element access without check", () => {
    const code = `
function testTuple(x: [string, number?]) {
  console.log(x[1].toFixed());
}
    `.trim();
    const findings = runRuleOnCode(uncheckedIndexAccessRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "typescript/unchecked-index-access");
  });

  test("phase C matrix: flags arbitrary rest element index on rest tuple", () => {
    const code = `
function testTuple(x: [string, ...number[]]) {
  console.log(x[10].toFixed());
}
    `.trim();
    const findings = runRuleOnCode(uncheckedIndexAccessRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "typescript/unchecked-index-access");
  });
});
