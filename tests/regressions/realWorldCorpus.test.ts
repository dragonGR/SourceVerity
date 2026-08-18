import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { nonNullAssertionRiskRule } from "../../src/rules/typescript/nonNullAssertionRisk.js";
import { derivedStateEffectRule } from "../../src/rules/react/derivedStateEffect.js";
import { floatingPromiseRule } from "../../src/rules/async/floatingPromise.js";
import { runRuleOnCode } from "../rules/ruleTestUtils.js";

export interface PrecisionFixtureTestCase {
  readonly name: string;
  readonly ruleId: string;
  readonly code: string;
  readonly expectedFindingCount: number;
  readonly expectedSeverity?: "error" | "warning" | "info" | undefined;
  readonly expectedConfidence?: "high" | "medium" | "low" | undefined;
  readonly rationale: string;
}

export const REAL_WORLD_PRECISION_CORPUS: readonly PrecisionFixtureTestCase[] = [
  // ── CASE GROUP A: Guarded Array Index & Non-Null Assertion ──────────────────
  {
    name: "Case A (Safe): Dominating guard proves array index + 1 in bounds",
    ruleId: "typescript/non-null-assertion-risk",
    code: `
const ITEMS: (string | undefined)[] = ["pioneer", "noder1", "noder2", "noder3", "king"];
export function getNextTier(tier: string): string | null {
  const idx = ITEMS.indexOf(tier);
  if (idx === -1 || idx >= ITEMS.length - 1) return null;
  const next = ITEMS[idx + 1]!;
  return next;
}
    `.trim(),
    expectedFindingCount: 0,
    rationale: "Guard 'idx === -1 || idx >= ITEMS.length - 1' guarantees idx >= 0 and idx + 1 < ITEMS.length.",
  },
  {
    name: "Case A (Near-Miss Unsafe): Unguarded array index + 1 non-null assertion",
    ruleId: "typescript/non-null-assertion-risk",
    code: `
const ITEMS: (string | undefined)[] = ["pioneer", "noder1", "noder2", "noder3", "king"];
export function getNextTier(tier: string): string | null {
  const idx = ITEMS.indexOf(tier);
  const next = ITEMS[idx + 1]!;
  return next;
}
    `.trim(),
    expectedFindingCount: 1,
    expectedSeverity: "warning",
    expectedConfidence: "high",
    rationale: "Without bounds guard, idx can be -1 or length - 1, producing out-of-bounds undefined at runtime.",
  },

  // ── CASE GROUP B: React Derived State vs State Reset ─────────────────────────
  {
    name: "Case B (Safe): State reset to constant 0 on lifecycle/input trigger",
    ruleId: "react/derived-state-effect",
    code: `
import { useEffect, useState } from 'react';
function MessageRotator({ isScanning }: { isScanning: boolean }) {
  const [messageIndex, setMessageIndex] = useState(0);
  useEffect(() => {
    setMessageIndex(0);
  }, [isScanning]);
  return <div>{messageIndex}</div>;
}
    `.trim(),
    expectedFindingCount: 0,
    rationale: "setMessageIndex(0) resets state to constant 0 and does not mirror or derive from isScanning.",
  },
  {
    name: "Case B (Near-Miss Derived): State setter mirroring prop directly in useEffect",
    ruleId: "react/derived-state-effect",
    code: `
import { useEffect, useState } from 'react';
function StakeManager({ minimumStakeAmount }: { minimumStakeAmount: number }) {
  const [minimumStakeState, setMinimumStakeState] = useState(minimumStakeAmount);
  useEffect(() => {
    setMinimumStakeState(minimumStakeAmount);
  }, [minimumStakeAmount]);
  return <div>{minimumStakeState}</div>;
}
    `.trim(),
    expectedFindingCount: 1,
    expectedSeverity: "warning",
    expectedConfidence: "high",
    rationale: "Synchronizing state directly from props in useEffect causes unnecessary re-renders.",
  },

  // ── CASE GROUP C & D: Promise Assignment, Caching & Return ──────────────────
  {
    name: "Case C/D (Safe): Cached lazy Promise loader assigned and returned",
    ruleId: "async/floating-promise",
    code: `
let cachedService: Promise<{ execute: () => void }> | null = null;
export function getService(): Promise<{ execute: () => void }> {
  if (!cachedService) {
    cachedService = Promise.resolve({ execute: () => {} }).catch((err) => {
      cachedService = null;
      throw err;
    });
  }
  return cachedService;
}
    `.trim(),
    expectedFindingCount: 0,
    rationale: "The assigned Promise is cached and returned from the enclosing function to the caller.",
  },
  {
    name: "Case C (Near-Miss Floating): Bare Promise call without await or return",
    ruleId: "async/floating-promise",
    code: `
declare function synchronize(): Promise<void>;
export function performWork() {
  synchronize();
}
    `.trim(),
    expectedFindingCount: 1,
    expectedSeverity: "warning",
    expectedConfidence: "medium",
    rationale: "Uninspected external Promise-returning function called without explicit consumption is reported as calibrated warning/medium confidence.",
  },

  // ── CASE GROUP E: Promise .finally() Discard vs Return ───────────────────────
  {
    name: "Case E (Safe): Returned .finally() Promise chain",
    ruleId: "async/floating-promise",
    code: `
declare function fetchToken(): Promise<string>;
declare function cleanState(): void;
export function getToken(): Promise<string> {
  return fetchToken().finally(cleanState);
}
    `.trim(),
    expectedFindingCount: 0,
    rationale: "The Promise returned by .finally() is returned to the caller.",
  },
  {
    name: "Case E (Discarded): Discarded .finally() Promise on returned base Promise",
    ruleId: "async/floating-promise",
    code: `
declare function generateSalt(): Promise<string>;
const inflight = new Map<string, Promise<string>>();
export async function getSalt(key: string): Promise<string> {
  const p = generateSalt();
  inflight.set(key, p);
  p.finally(() => inflight.delete(key));
  return p;
}
    `.trim(),
    expectedFindingCount: 1,
    expectedSeverity: "error",
    expectedConfidence: "high",
    rationale: "p.finally(...) creates a new un-returned Promise whose potential rejection is unhandled.",
  },

  // ── CASE GROUP F: Terminal .catch().finally() Chains ─────────────────────────
  {
    name: "Case F (Safe): .then().catch().finally() chain in statement position",
    ruleId: "async/floating-promise",
    code: `
declare function verifyStake(opts: { address: string }): Promise<{ success: boolean }>;
export function autoResume(address: string) {
  verifyStake({ address })
    .then((res) => { if (res.success) console.log("ok"); })
    .catch((err) => { console.warn("recovery skipped", err); })
    .finally(() => { console.log("done"); });
}
    `.trim(),
    expectedFindingCount: 0,
    rationale: "Rejection is handled by terminal .catch() before .finally(); idiomatic terminal chain.",
  },
  {
    name: "Case F (Near-Miss Unsafe): .then().finally() chain without catch handler",
    ruleId: "async/floating-promise",
    code: `
declare function verifyStake(opts: { address: string }): Promise<{ success: boolean }>;
export function autoResume(address: string) {
  verifyStake({ address })
    .then((res) => { if (res.success) console.log("ok"); })
    .finally(() => { console.log("done"); });
}
    `.trim(),
    expectedFindingCount: 1,
    expectedSeverity: "error",
    expectedConfidence: "high",
    rationale: "Chain lacks .catch() handler, so any rejection in verifyStake or .then() handler floats.",
  },

  // ── CASE GROUP G: Internal Async Error Handling ──────────────────────────────
  {
    name: "Case G (Calibrated): Local async function with complete try/catch called in useEffect",
    ruleId: "async/floating-promise",
    code: `
import { useEffect } from 'react';
declare function fetchStatus(): Promise<boolean>;
function StatusMonitor() {
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const isPaused = await fetchStatus();
        console.log("status", isPaused);
      } catch (error) {
        console.error("error checking status", error);
      } finally {
        console.log("check completed");
      }
    };
    checkStatus();
  }, []);
  return null;
}
    `.trim(),
    expectedFindingCount: 1,
    expectedSeverity: "warning",
    expectedConfidence: "medium",
    rationale: "checkStatus handles errors internally but returns an unconsumed floating Promise, reported with calibrated warning/medium confidence.",
  },
  {
    name: "Case G (Near-Miss Unsafe): Async function with try/finally (NO CATCH) called in useEffect",
    ruleId: "async/floating-promise",
    code: `
import { useEffect } from 'react';
declare function syncWallet(): Promise<void>;
function WalletSync() {
  useEffect(() => {
    const checkAndSync = async () => {
      try {
        await syncWallet();
      } finally {
        console.log("sync cleanup");
      }
    };
    checkAndSync();
  }, []);
  return null;
}
    `.trim(),
    expectedFindingCount: 1,
    expectedSeverity: "error",
    expectedConfidence: "high",
    rationale: "try/finally without catch re-throws rejections from syncWallet into unhandled floating promise.",
  },

  // ── CASE GROUP H: Optional Promise Union Return Types (e.g. NavigateFunction) ─
  // ── CASE GROUP H: Optional Promise Union Return Types ────────────────────────
  {
    name: "Case H (Calibrated): Arbitrary optional Promise union (void | Promise<void>) receives medium confidence warning",
    ruleId: "async/floating-promise",
    code: `
declare function maybeAsync(path: string): void | Promise<void>;
export function handleLogout() {
  maybeAsync("/login");
}
    `.trim(),
    expectedFindingCount: 1,
    expectedSeverity: "warning",
    expectedConfidence: "medium",
    rationale: "Arbitrary optional union return type carries uncertainty and is reported as a calibrated medium-confidence warning.",
  },

  // ── CASE GROUP I: AnimationPlaybackControls / Lifecycle Handles vs Discarded Promises ──
  {
    name: "Case I (Safe): Thenable AnimationPlaybackControls retained and stopped in effect cleanup",
    ruleId: "async/floating-promise",
    code: `
import { useEffect } from 'react';
interface AnimationPlaybackControls extends PromiseLike<void> {
  stop(): void;
  pause(): void;
  play(): void;
  then(onResolve?: () => void): Promise<void>;
}
declare function animate(from: number, to: number, options?: { duration: number }): AnimationPlaybackControls;
export function Counter({ value }: { value: number }) {
  useEffect(() => {
    const controls = animate(0, value, { duration: 0.8 });
    return () => controls.stop();
  }, [value]);
  return <span>{value}</span>;
}
    `.trim(),
    expectedFindingCount: 0,
    rationale: "AnimationPlaybackControls is an active lifecycle control handle with .stop(), not an unhandled asynchronous Promise.",
  },
  {
    name: "Case I (Near-Miss Floating): Bare Promise initialized in local variable without return or consumption",
    ruleId: "async/floating-promise",
    code: `
declare function loadData(): Promise<string>;
export function execute() {
  const p = loadData();
}
    `.trim(),
    expectedFindingCount: 1,
    expectedSeverity: "error",
    expectedConfidence: "high",
    rationale: "Variable 'p' holds an unhandled Promise that is discarded without being returned, awaited, or caught.",
  },
];

describe("real-world regression corpus & precision manifest", () => {
  for (const testCase of REAL_WORLD_PRECISION_CORPUS) {
    test(testCase.name, () => {
      let rule;
      if (testCase.ruleId === "typescript/non-null-assertion-risk") {
        rule = nonNullAssertionRiskRule;
      } else if (testCase.ruleId === "react/derived-state-effect") {
        rule = derivedStateEffectRule;
      } else if (testCase.ruleId === "async/floating-promise") {
        rule = floatingPromiseRule;
      } else {
        throw new Error(`Unknown rule ${testCase.ruleId}`);
      }

      const findings = runRuleOnCode(rule, testCase.code);
      assert.equal(
        findings.length,
        testCase.expectedFindingCount,
        `Expected ${testCase.expectedFindingCount} findings for '${testCase.name}', got ${findings.length}. Rationale: ${testCase.rationale}`
      );

      if (testCase.expectedFindingCount > 0 && testCase.expectedSeverity) {
        assert.equal(findings[0]?.severity, testCase.expectedSeverity);
      }
      if (testCase.expectedFindingCount > 0 && testCase.expectedConfidence) {
        assert.equal(findings[0]?.confidence, testCase.expectedConfidence);
      }
    });
  }
});
