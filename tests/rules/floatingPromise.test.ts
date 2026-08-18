import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { floatingPromiseRule } from "../../src/rules/async/floatingPromise.js";
import { runRuleOnCode } from "./ruleTestUtils.js";

describe("rule async/floating-promise", () => {
  // --- NO FINDING (Explicitly Consumed) ---

  test("does not flag awaited promise", () => {
    const code = `
async function load(): Promise<string> { return "ok"; }
async function run() {
  await load();
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag returned promise", () => {
    const code = `
async function load(): Promise<string> { return "ok"; }
function run(): Promise<string> {
  return load();
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag void promise", () => {
    const code = `
async function load(): Promise<string> { return "ok"; }
function run() {
  void load();
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag void promise.catch(handler)", () => {
    const code = `
async function load(): Promise<string> { return "ok"; }
function run() {
  void load().catch((err) => console.error(err));
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag await promise.catch(handler)", () => {
    const code = `
async function load(): Promise<string> { return "ok"; }
async function run() {
  await load().catch((err) => { console.error(err); return ""; });
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag return promise.then(onFulfilled, onRejected)", () => {
    const code = `
async function load(): Promise<string> { return "ok"; }
function run(): Promise<string> {
  return load().then((res) => res, (err) => "");
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag parenthesized (await promise)", () => {
    const code = `
async function load(): Promise<string> { return "ok"; }
async function run() {
  (await load());
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag methods named catch or then on non-Promise objects", () => {
    const code = `
class QueryBuilder {
  catch(rule: unknown) {}
  then(step: unknown) {}
}
function run() {
  const q = new QueryBuilder();
  q.catch({});
  q.then({});
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 0);
  });

  // --- FINDINGS (Unconsumed Promise Expression Statements) ---

  test("flags bare promise expression statement", () => {
    const code = `
async function load(): Promise<string> { return "ok"; }
function run() {
  load();
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "async/floating-promise");
  });

  test("flags promise.then(handler) expression statement", () => {
    const code = `
async function load(): Promise<string> { return "ok"; }
function run() {
  load().then((r) => console.log(r));
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
  });

  test("flags promise.catch(handler) expression statement", () => {
    const code = `
async function load(): Promise<string> { return "ok"; }
function run() {
  load().catch((err) => console.error(err));
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
  });

  test("flags promise.finally(cleanup) expression statement", () => {
    const code = `
async function load(): Promise<string> { return "ok"; }
function run() {
  load().finally(() => console.log("done"));
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
  });

  test("flags promise.catch(handler).then(next) expression statement", () => {
    const code = `
async function load(): Promise<string> { return "ok"; }
function run() {
  load().catch((err) => "").then((r) => console.log(r));
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
  });

  test("flags promise.then(next).catch(handler) expression statement", () => {
    const code = `
async function load(): Promise<string> { return "ok"; }
function run() {
  load().then((r) => r).catch((err) => console.error(err));
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
  });

  test("flags promise.catch(handler).finally(cleanup) expression statement", () => {
    const code = `
async function load(): Promise<string> { return "ok"; }
function run() {
  load().catch((err) => "").finally(() => console.log("done"));
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
  });

  test("flags promise.then(onFulfilled, onRejected) expression statement", () => {
    const code = `
async function load(): Promise<string> { return "ok"; }
function run() {
  load().then((r) => console.log(r), (err) => console.error(err));
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
  });

  test("flags parenthesized unconsumed promise (promise.catch(handler))", () => {
    const code = `
async function load(): Promise<string> { return "ok"; }
function run() {
  (load().catch((err) => console.error(err)));
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
  });

  test("flags custom Promise-like thenable expression statement", () => {
    const code = `
interface CustomThenable<T> {
  then(onfulfilled?: (value: T) => any): any;
}
declare function makeThenable(): CustomThenable<number>;
function run() {
  makeThenable();
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
  });
});
