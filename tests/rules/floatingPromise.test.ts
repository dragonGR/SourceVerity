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

  test("flags internal async function with exhaustive try/catch with calibrated medium confidence warning", () => {
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
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.severity, "warning");
    assert.equal(findings[0]?.confidence, "medium");
    assert.equal(findings[0]?.message, "Promise returned by this call is not explicitly consumed.");
  });

  test("does not flag internal async function when explicitly voided", () => {
    const code = `
async function refresh() {
  try {
    await Promise.resolve();
  } catch (error) {
    console.error(error);
  }
}
function run() {
  void refresh();
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 0);
  });

  test("flags local function with proven rejection propagation as error with high confidence", () => {
    const code = `
declare function syncRemote(): Promise<void>;
async function checkAndSync() {
  try {
    await syncRemote();
  } finally {
    console.log("cleanup");
  }
}
function run() {
  checkAndSync();
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.severity, "error");
    assert.equal(findings[0]?.confidence, "high");
    assert.equal(findings[0]?.message, "Promise is discarded and its rejection can escape unhandled.");
  });

  test("flags unknown imported async function as warning with medium confidence", () => {
    const code = `
declare function saveContext(data: unknown): Promise<void>;
function run() {
  saveContext({ id: "123" });
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.severity, "warning");
    assert.equal(findings[0]?.confidence, "medium");
    assert.equal(findings[0]?.message, "Promise returned by this call is not explicitly consumed.");
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
    assert.equal(findings[0]?.ruleId, "async/floating-promise");
    assert.equal(findings[0]?.severity, "error");
    assert.equal(findings[0]?.confidence, "high");
    assert.equal(findings[0]?.message, "Promise is discarded and its rejection can escape unhandled.");
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

  test("near-miss: flags custom user function named test that returns Promise", () => {
    const code = `
function test(): Promise<void> {
  return Promise.reject(new Error("failure"));
}

function runTests() {
  test();
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "async/floating-promise");
    assert.equal(findings[0]?.severity, "error");
    assert.equal(findings[0]?.confidence, "high");
  });

  test("near-miss: flags custom user function named describe that returns Promise", () => {
    const code = `
function describe(): Promise<void> {
  return Promise.reject(new Error("failure"));
}

function runSuite() {
  describe();
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.severity, "error");
    assert.equal(findings[0]?.confidence, "high");
  });

  test("near-miss: flags custom dangerous thenable with animation control methods", () => {
    const code = `
interface DangerousAnimation extends PromiseLike<void> {
  pause(): void;
  play(): void;
}

declare function customAnimate(): DangerousAnimation;

function trigger() {
  customAnimate();
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "async/floating-promise");
  });

  test("flags unhandled rejection path inside React event handler", () => {
    const code = `
declare function deleteItem(id: string): Promise<void>;

function DeleteButton({ id }: { id: string }) {
  return (
    <button
      onClick={() => {
        deleteItem(id);
      }}
    >
      Delete
    </button>
  );
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "async/floating-promise");
  });

  test("flags variable assignment when first-level alias is overwritten with null before return", () => {
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
  });

  test("flags variable assignment when second-level alias is overwritten with null before return", () => {
    const code = `
declare function loadData(): Promise<string>;
function testFlow() {
  let p: Promise<string> | null = loadData();
  let q: Promise<string> | null = p;
  let r: Promise<string> | null = q;
  r = null;
  return r;
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
  });

  test("does not flag variable assignment when surviving sibling alias is returned", () => {
    const code = `
declare function loadData(): Promise<string>;
function testFlow() {
  let p: Promise<string> | null = loadData();
  let q: Promise<string> | null = p;
  let r: Promise<string> | null = q;
  q = null;
  return r;
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 0);
  });

  test("flags variable assignment when alias is reassigned to another Promise", () => {
    const code = `
declare function loadData(): Promise<string>;
declare function otherPromise(): Promise<string>;
function testFlow() {
  let p = loadData();
  let q = p;
  q = otherPromise();
  return q;
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
  });

  test("flags variable assignment when alias is conditionally reassigned to null", () => {
    const code = `
declare function loadData(): Promise<string>;
function testFlow(c: boolean) {
  let p: Promise<string> | null = loadData();
  let q: Promise<string> | null = p;
  if (c) {
    q = null;
  }
  return q;
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
  });

  test("flags floating call when async function preamble performs JSON.parse before try", () => {
    const code = `
declare function work(): Promise<void>;
async function processPayload(jsonStr: string) {
  const data = JSON.parse(jsonStr);
  try {
    await work();
  } catch (err) {
    console.error(err);
  }
}
function run(raw: string) {
  processPayload(raw);
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.severity, "error");
    assert.equal(findings[0]?.confidence, "high");
  });

  test("flags floating call when async function preamble performs unknown call before try", () => {
    const code = `
declare function doUnknownWork(): void;
declare function work(): Promise<void>;
async function execute() {
  doUnknownWork();
  try {
    await work();
  } catch (err) {
    console.error(err);
  }
}
function run() {
  execute();
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.severity, "error");
    assert.equal(findings[0]?.confidence, "high");
  });

  test("does not flag floating call as error when async function preamble only contains safe primitive/local assignments", () => {
    const code = `
declare function work(): Promise<void>;
async function execute() {
  const a = 1;
  const b = "ok";
  try {
    await work();
  } catch (err) {
    console.error(err);
  }
}
function run() {
  execute();
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.severity, "warning");
    assert.equal(findings[0]?.confidence, "medium");
  });

  test("does not flag floating call as error when async function preamble only contains safe logging and timer cleanup", () => {
    const code = `
declare function work(): Promise<void>;
async function execute(timerId: number) {
  console.log("starting");
  clearTimeout(timerId);
  try {
    await work();
  } catch (err) {
    console.error(err);
  }
}
function run(t: number) {
  execute(t);
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.severity, "warning");
    assert.equal(findings[0]?.confidence, "medium");
  });

  test("flags floating call when async function executes unknown call after try/catch block", () => {
    const code = `
declare function work(): Promise<void>;
declare function postSyncWork(): void;
async function execute() {
  try {
    await work();
  } catch (err) {
    console.error(err);
  }
  postSyncWork();
}
function run() {
  execute();
}
    `.trim();
    const findings = runRuleOnCode(floatingPromiseRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.severity, "error");
    assert.equal(findings[0]?.confidence, "high");
  });
});
