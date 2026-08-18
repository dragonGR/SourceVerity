import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { floatingPromiseRule } from "../../src/rules/async/floatingPromise.js";
import { runRuleOnCode } from "./ruleTestUtils.js";

describe("rule async/floating-promise", () => {
  // --- NO FINDING (Explicitly Consumed or Handled) ---

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

  test("does not flag promise.catch(handler) expression statement", () => {
    const code = `
async function load(): Promise<string> { return "ok"; }
function run() {
  load().catch((err) => console.error(err));
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag promise.then(onFulfilled, onRejected) expression statement", () => {
    const code = `
async function load(): Promise<string> { return "ok"; }
function run() {
  load().then((r) => console.log(r), (err) => console.error(err));
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag promise.then(transform).catch(handler) expression statement", () => {
    const code = `
async function load(): Promise<string> { return "ok"; }
function run() {
  load().then((r) => r).catch((err) => console.error(err));
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag parenthesized promise.catch(handler)", () => {
    const code = `
async function load(): Promise<string> { return "ok"; }
function run() {
  (load().catch((err) => console.error(err)));
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag real-world import().then().catch() dynamic loader", () => {
    const code = `
declare function callback(err: Error | null, res?: unknown): void;
function load() {
  import('./locales/el/index')
    .then((module) => {
      callback(null, module.default);
    })
    .catch((err: unknown) => {
      callback(err instanceof Error ? err : new Error(String(err)));
    });
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag real-world navigator.clipboard.writeText().then(onFulfilled, onRejected)", () => {
    const code = `
declare const articleUrl: string;
declare function setCopied(copied: boolean): void;
function run() {
  navigator.clipboard.writeText(articleUrl).then(
    () => {
      setCopied(true);
    },
    () => {
      // intentionally ignored
    },
  );
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

  // --- FINDINGS (Unconsumed / Unhandled Promise Expression Statements) ---

  test("flags bare promise expression statement (doWork())", () => {
    const code = `
declare function doWork(): Promise<void>;
function run() {
  doWork();
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "async/floating-promise");
  });

  test("flags promise.then(handleSuccess) expression statement", () => {
    const code = `
declare function doWork(): Promise<void>;
declare function handleSuccess(): void;
function run() {
  doWork().then(handleSuccess);
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
  });

  test("flags promise.finally(cleanup) expression statement", () => {
    const code = `
declare function doWork(): Promise<void>;
declare function cleanup(): void;
function run() {
  doWork().finally(cleanup);
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
  });

  test("flags promise.then(handleSuccess).finally(cleanup) expression statement", () => {
    const code = `
declare function doWork(): Promise<void>;
declare function handleSuccess(): void;
declare function cleanup(): void;
function run() {
  doWork()
    .then(handleSuccess)
    .finally(cleanup);
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
  });

  test("flags promise.catch(handler).then(onFulfilled) expression statement", () => {
    const code = `
async function load(): Promise<string> { return "ok"; }
function run() {
  load().catch((err) => "").then((r) => console.log(r));
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

  test("flags custom Promise-like thenable expression statement", () => {
    const code = `
interface CustomThenable<T> {
  then(onfulfilled?: (value: T) => unknown): unknown;
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
