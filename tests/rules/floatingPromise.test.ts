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

  test("does not flag promise.catch(handler).finally(cleanup) expression statement", () => {
    const code = `
async function load(): Promise<string> { return "ok"; }
function run() {
  load().catch((err) => "").finally(() => console.log("done"));
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag cached Promise assignment returned from enclosing function", () => {
    const code = `
let cached: Promise<string> | null = null;
function getService() {
  if (!cached) {
    cached = Promise.resolve("svc").catch((err) => "fallback");
  }
  return cached;
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag internal async function with exhaustive try/catch", () => {
    const code = `
async function refresh() {
  try {
    await Promise.resolve();
  } catch (error) {
    console.error(error);
  }
}
function run() {
  refresh();
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 0);
  });

  test("flags arbitrary optional Promise union return type with calibrated medium confidence", () => {
    const code = `
declare function maybeAsync(to: string): void | Promise<void>;
function run() {
  maybeAsync("/home");
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.severity, "warning");
    assert.equal(findings[0]?.confidence, "medium");
  });

  test("flags unreturned discarded finally promise", () => {
    const code = `
async function fetchResource(): Promise<string> { return "ok"; }
function run() {
  const p = fetchResource();
  p.finally(() => console.log("cleanup"));
  return p;
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

  test("does not flag thenable animation playback controls stored in variable and stopped in cleanup", () => {
    const code = `
interface AnimationPlaybackControls extends PromiseLike<void> {
  time: number;
  speed: number;
  stop: () => void;
  play: () => void;
  pause: () => void;
  cancel: () => void;
  then: (onResolve?: () => void, onReject?: () => void) => Promise<void>;
}
declare function animate(from: number, to: number, options?: Record<string, unknown>): AnimationPlaybackControls;
declare function useEffect(effect: () => (() => void) | void, deps?: readonly unknown[]): void;

function Component() {
  useEffect(() => {
    const controls = animate(0, 100, { duration: 0.8 });
    return () => controls.stop();
  }, []);
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag thenable control handle with stop, pause, or cancel methods in statement position", () => {
    const code = `
interface TweenControl {
  stop(): void;
  pause(): void;
  then(resolve: () => void): Promise<void>;
}
declare function startTween(): TweenControl;
function run() {
  const tween = startTween();
  tween.pause();
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 0);
  });

  test("flags bare i18next init call with options object and without callback, await, or catch", () => {
    const code = `
interface InitOptions {
  lng: string;
  fallbackLng: string;
}
interface i18n {
  init(options: InitOptions): Promise<unknown>;
  init(options: InitOptions, callback?: (err: unknown, t: unknown) => void): Promise<unknown>;
  init(callback?: (err: unknown, t: unknown) => void): Promise<unknown>;
}
declare const i18nInstance: i18n;
const opts: InitOptions = { lng: 'en', fallbackLng: 'en' };
function setup() {
  i18nInstance.init(opts);
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "async/floating-promise");
    assert.equal(findings[0]?.severity, "error");
  });

  test("does not flag i18next init call with options and completion callback", () => {
    const code = `
interface InitOptions {
  lng: string;
  fallbackLng: string;
}
interface i18n {
  init(options: InitOptions): Promise<unknown>;
  init(options: InitOptions, callback?: (err: unknown, t: unknown) => void): Promise<unknown>;
  init(callback?: (err: unknown, t: unknown) => void): Promise<unknown>;
}
declare const i18nInstance: i18n;
const opts: InitOptions = { lng: 'en', fallbackLng: 'en' };
function setup() {
  i18nInstance.init(opts, (err, t) => {
    if (err) console.error(err);
  });
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag i18next init call with single callback argument", () => {
    const code = `
interface i18n {
  init(callback?: (err: unknown, t: unknown) => void): Promise<unknown>;
}
declare const i18nInstance: i18n;
function setup() {
  i18nInstance.init((err, t) => {
    if (err) console.error(err);
  });
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 0);
  });
});
