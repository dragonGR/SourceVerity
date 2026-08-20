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

    test("does not flag static array indexed with in-bounds literal integer", () => {
      const code = `
  const TIERS: ({ y: number } | undefined)[] = [{ y: 10 }, { y: 20 }, { y: 30 }];
  function getTier() {
    const first = TIERS[0]!;
    const second = TIERS[1]!;
    return { first, second };
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("near-miss: flags static array indexed with out-of-bounds literal", () => {
      const code = `
  const TIERS: ({ y: number } | undefined)[] = [{ y: 10 }];
  function getTier() {
    const invalid = TIERS[5]!;
    return invalid;
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("near-miss: flags empty static array indexed with literal", () => {
      const code = `
  const EMPTY: ({ y: number } | undefined)[] = [];
  function getFirst() {
    const item = EMPTY[0]!;
    return item;
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("does not flag array index access bounded by for loop condition", () => {
      const code = `
  const ITEMS: (string | undefined)[] = ["a", "b", "c"];
  function processItems() {
    for (let i = 0; i < ITEMS.length; i++) {
      const item = ITEMS[i]!;
      console.log(item);
    }
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("does not flag array index + 1 bounded by for loop condition < length - 1", () => {
      const code = `
  const ITEMS: (string | undefined)[] = ["a", "b", "c"];
  function processPairs() {
    for (let i = 0; i < ITEMS.length - 1; i++) {
      const next = ITEMS[i + 1]!;
      console.log(next);
    }
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("near-miss: flags array index + 1 in for loop bounded by length (not length - 1)", () => {
      const code = `
  const ITEMS: (string | undefined)[] = ["a", "b", "c"];
  function processPairs() {
    for (let i = 0; i < ITEMS.length; i++) {
      const next = ITEMS[i + 1]!;
      console.log(next);
    }
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("does not flag array index access inside matching .map callback", () => {
      const code = `
  const ITEMS: (string | undefined)[] = ["a", "b", "c"];
  function mapItems() {
    return ITEMS.map((item, i) => ITEMS[i]!);
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("near-miss: flags array index access in mismatched .map callback", () => {
      const code = `
  const ITEMS: (string | undefined)[] = ["a", "b", "c"];
  const OTHER: string[] = ["x", "y", "z", "w", "v"];
  function mapItems() {
    return OTHER.map((item, i) => ITEMS[i]!);
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("does not flag React state indexing static const array with verified bounds", () => {
      const code = `
  import { useState } from 'react';

  const STEPS: ({ title: string } | undefined)[] = [
    { title: 'Step 1' },
    { title: 'Step 2' },
    { title: 'Step 3' },
  ];

  function LabComponent() {
    const [step, setStep] = useState(0);
    const current = STEPS[step]!;

    const handleNext = () => {
      if (step < STEPS.length - 1) {
        setStep(step + 1);
      }
    };

    const handlePrev = () => {
      if (step > 0) {
        setStep(step - 1);
      }
    };

    return null;
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("near-miss: flags React state indexing when setter escapes as JSX prop", () => {
      const code = `
  import { useState } from 'react';

  const STEPS: ({ title: string } | undefined)[] = [
    { title: 'Step 1' },
    { title: 'Step 2' },
  ];

  function Child(props: { onStep: (s: number) => void }) {
    return null;
  }

  function LabComponent() {
    const [step, setStep] = useState(0);
    const current = STEPS[step]!;

    return <Child onStep={setStep} />;
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("near-miss: flags React state indexing when setter receives out-of-bounds literal", () => {
      const code = `
  import { useState } from 'react';

  const STEPS: ({ title: string } | undefined)[] = [
    { title: 'Step 1' },
    { title: 'Step 2' },
  ];

  function LabComponent() {
    const [step, setStep] = useState(0);
    const current = STEPS[step]!;

    const jump = () => setStep(999);

    return null;
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("near-miss: flags React state indexing when initial state is out of bounds", () => {
      const code = `
  import { useState } from 'react';

  const STEPS: ({ title: string } | undefined)[] = [
    { title: 'Step 1' },
    { title: 'Step 2' },
  ];

  function LabComponent() {
    const [step, setStep] = useState(-1);
    const current = STEPS[step]!;
    return null;
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    // --- findIndex contract proofs and near-misses ---

    test("does not flag array index when guarded by findIndex !== -1 exit guard", () => {
      const code = `
  const items: (string | undefined)[] = ["a", "b", "c"];
  function findItem(predicate: (x: string | undefined) => boolean) {
    const idx = items.findIndex(predicate);
    if (idx === -1) return;
    const item = items[idx]!;
    return item;
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("does not flag array index in loop when guarded by findIndex === -1 continue", () => {
      const code = `
  interface Block { start: number; pages: number; allocated: boolean; }
  function merge(next: (Block | undefined)[]) {
    for (let i = 0; i < next.length; i++) {
      const buddyIndex = next.findIndex(other => other && !other.allocated);
      if (buddyIndex === -1 || buddyIndex === i) continue;
      const buddy = next[buddyIndex]!;
      console.log(buddy);
    }
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("does not flag array index inside positive findIndex !== -1 if block", () => {
      const code = `
  const items: (string | undefined)[] = ["a", "b", "c"];
  function findItem(predicate: (x: string | undefined) => boolean) {
    const idx = items.findIndex(predicate);
    if (idx !== -1) {
      return items[idx]!;
    }
    return null;
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("near-miss: flags findIndex result when unguarded", () => {
      const code = `
  const items: (string | undefined)[] = ["a", "b", "c"];
  function findItem(predicate: (x: string | undefined) => boolean) {
    const idx = items.findIndex(predicate);
    return items[idx]!;
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("near-miss: flags findIndex result used against different array", () => {
      const code = `
  const items: (string | undefined)[] = ["a", "b", "c"];
  const other: (string | undefined)[] = ["x", "y"];
  function findItem(predicate: (x: string | undefined) => boolean) {
    const idx = items.findIndex(predicate);
    if (idx === -1) return null;
    return other[idx]!;
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("near-miss: flags findIndex result when variable is reassigned", () => {
      const code = `
  const items: (string | undefined)[] = ["a", "b", "c"];
  function findItem(predicate: (x: string | undefined) => boolean, ext: number) {
    let idx = items.findIndex(predicate);
    if (idx === -1) return null;
    idx = ext;
    return items[idx]!;
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("near-miss: flags findIndex result when array is mutated after guard", () => {
      const code = `
  const items: (string | undefined)[] = ["a", "b", "c"];
  function findItem(predicate: (x: string | undefined) => boolean) {
    const idx = items.findIndex(predicate);
    if (idx === -1) return null;
    items.splice(0);
    return items[idx]!;
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    // --- Loop bounds offset generalizations ---

    test("does not flag multiple in-bounds offsets inside for loop bounded by length - 2", () => {
      const code = `
  const items: (string | undefined)[] = ["a", "b", "c", "d"];
  function processTriples() {
    for (let i = 0; i < items.length - 2; i++) {
      const a = items[i]!;
      const b = items[i + 1]!;
      const c = items[i + 2]!;
      console.log(a, b, c);
    }
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("near-miss: flags loop offset exceeding condition margin (i + 2 in length - 1 loop)", () => {
      const code = `
  const items: (string | undefined)[] = ["a", "b", "c", "d"];
  function processTriples() {
    for (let i = 0; i < items.length - 1; i++) {
      const c = items[i + 2]!;
      console.log(c);
    }
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("near-miss: flags loop offset on different array", () => {
      const code = `
  const items: (string | undefined)[] = ["a", "b", "c", "d"];
  const other: (string | undefined)[] = ["x", "y"];
  function process() {
    for (let i = 0; i < items.length - 1; i++) {
      const next = other[i + 1]!;
      console.log(next);
    }
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    // --- Sliced array .map index relationship ---

    test("does not flag arr.slice(0, -1).map with arr[i + 1]!", () => {
      const code = `
  const nodes: ({ x: number; y: number } | undefined)[] = [
    { x: 10, y: 20 },
    { x: 30, y: 40 },
    { x: 50, y: 60 },
  ];
  function render() {
    return nodes.slice(0, -1).map((n, i) => {
      const next = nodes[i + 1]!;
      return next.x;
    });
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("near-miss: flags arr.slice(0, -1).map with arr[i + 2]! (offset exceeds slice margin)", () => {
      const code = `
  const nodes: ({ x: number; y: number } | undefined)[] = [
    { x: 10, y: 20 },
    { x: 30, y: 40 },
  ];
  function render() {
    return nodes.slice(0, -1).map((n, i) => {
      const next = nodes[i + 2]!;
      return next.x;
    });
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("near-miss: flags arr.slice(0, -1).map indexing different array", () => {
      const code = `
  const nodes: ({ x: number } | undefined)[] = [{ x: 1 }, { x: 2 }];
  const other: ({ x: number } | undefined)[] = [{ x: 10 }];
  function render() {
    return nodes.slice(0, -1).map((n, i) => {
      const next = other[i + 1]!;
      return next.x;
    });
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    // --- Explicit if guard with lower bound proof ---

    test("does not flag arr[i + 1]! inside .map when guarded by if (i < arr.length - 1)", () => {
      const code = `
  const STAGES: ({ label: string; x: number } | undefined)[] = [
    { label: 'A', x: 0 },
    { label: 'B', x: 100 },
  ];
  function render() {
    return STAGES.map((s, i) => {
      if (i < STAGES.length - 1) {
        const next = STAGES[i + 1]!;
        return next.x;
      }
      return null;
    });
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("does not flag arr[i + 1]! when guarded by if (i >= 0 && i < arr.length - 1)", () => {
      const code = `
  const STAGES: ({ x: number } | undefined)[] = [{ x: 10 }, { x: 20 }];
  function getNext(i: number) {
    if (i >= 0 && i < STAGES.length - 1) {
      return STAGES[i + 1]!;
    }
    return null;
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("near-miss: flags arr[i + 1]! when only upper bound is checked and i is unconstrained", () => {
      const code = `
  const STAGES: ({ x: number } | undefined)[] = [{ x: 10 }, { x: 20 }];
  function getNext(i: number) {
    if (i < STAGES.length - 1) {
      return STAGES[i + 1]!;
    }
    return null;
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    // --- Real bug regression: visible[0]![0] when visible.length < 2 ---

    test("flags real-world bug: visible[0]![0] where visible.length < 2 allows visible.length === 0", () => {
      const code = `
  interface Track {
    id: string;
    pts: (number[] | undefined)[];
  function renderTrack(trk: Track, phase: number) {
    const visible = trk.pts;
    if (visible.length < 2) {
      const firstX = visible[0]![0];
      return firstX;
    }
    return null;
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
      assert.equal(findings[0]?.ruleId, "typescript/non-null-assertion-risk");
    });

    // --- Construction cardinality proofs & unsafe twins ---

    test("does not flag arr[n]! when constructed with 1 initial element and n guaranteed pushes", () => {
      const code = `
  function computeAmplitudes(numLayers: number) {
    const amplitudes: (number | undefined)[] = [1.0];
    for (let i = 0; i < numLayers; i++) {
      amplitudes.push(amplitudes[amplitudes.length - 1]! * 0.35);
    }
    const last = amplitudes[numLayers]!;
    return last;
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("near-miss: flags arr[n]! when pushes inside loop are conditional", () => {
      const code = `
  function computeAmplitudes(numLayers: number, cond: boolean) {
    const amplitudes: (number | undefined)[] = [1.0];
    for (let i = 0; i < numLayers; i++) {
      if (cond) {
        amplitudes.push(0.5);
      }
    }
    const last = amplitudes[numLayers]!;
    return last;
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
      assert.equal(findings[0]?.ruleId, "typescript/non-null-assertion-risk");
    });

    test("near-miss: flags arr[n]! when loop performs too few pushes (n - 1)", () => {
      const code = `
  function computeAmplitudes(numLayers: number) {
    const amplitudes: (number | undefined)[] = [1.0];
    for (let i = 0; i < numLayers - 1; i++) {
      amplitudes.push(0.5);
    }
    const last = amplitudes[numLayers]!;
    return last;
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("near-miss: flags arr[n]! when loop contains continue statement", () => {
      const code = `
  function computeAmplitudes(numLayers: number) {
    const amplitudes: (number | undefined)[] = [1.0];
    for (let i = 0; i < numLayers; i++) {
      if (i === 2) continue;
      amplitudes.push(0.5);
    }
    const last = amplitudes[numLayers]!;
    return last;
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("near-miss: flags arr[n]! when array is mutated (pop) after construction loop", () => {
      const code = `
  function computeAmplitudes(numLayers: number) {
    const amplitudes: (number | undefined)[] = [1.0];
    for (let i = 0; i < numLayers; i++) {
      amplitudes.push(0.5);
    }
    amplitudes.pop();
    const last = amplitudes[numLayers]!;
    return last;
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("near-miss: flags arr[n]! when initial array is empty (0 initial elements)", () => {
      const code = `
  function computeAmplitudes(numLayers: number) {
    const amplitudes: (number | undefined)[] = [];
    for (let i = 0; i < numLayers; i++) {
      amplitudes.push(0.5);
    }
    const last = amplitudes[numLayers]!;
    return last;
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    // --- Search index provenance proofs & unsafe twins ---

    test("does not flag copy[victimIdx]! when victimIdx originates from loop over prev with exit guard", () => {
      const code = `
  interface Block { pages: string[]; }
  function runGC(prev: (Block | undefined)[]) {
    let victimIdx = -1;
    let maxInvalid = 0;
    for (let i = 0; i < prev.length; i++) {
      const inv = prev[i]!.pages.length;
      if (inv > maxInvalid) {
        maxInvalid = inv;
        victimIdx = i;
      }
    }
    if (victimIdx === -1 || maxInvalid === 0) {
      return prev;
    }
    const copy = prev.map(b => (b ? { ...b, pages: [...b.pages] } : undefined));
    const victim = copy[victimIdx]!;
    return victim;
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("near-miss: flags copy[idx]! when idx receives external unverified assignment", () => {
      const code = `
  interface Block { pages: string[]; }
  function runGC(prev: (Block | undefined)[], externalNum: number) {
    let victimIdx = -1;
    for (let i = 0; i < prev.length; i++) {
      victimIdx = externalNum;
    }
    if (victimIdx === -1) {
      return prev;
    }
    const copy = prev.map(b => (b ? { ...b, pages: [...b.pages] } : undefined));
    const victim = copy[victimIdx]!;
    return victim;
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("near-miss: flags copy[idx]! when idx is searched on different array", () => {
      const code = `
  interface Block { pages: string[]; }
  function runGC(prev: (Block | undefined)[], other: (Block | undefined)[]) {
    let victimIdx = -1;
    for (let i = 0; i < other.length; i++) {
      victimIdx = i;
    }
    if (victimIdx === -1) {
      return prev;
    }
    const copy = prev.map(b => (b ? { ...b, pages: [...b.pages] } : undefined));
    const victim = copy[victimIdx]!;
    return victim;
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("near-miss: flags copy[idx]! when array is mutated after guard", () => {
      const code = `
  interface Block { pages: string[]; }
  function runGC(prev: (Block | undefined)[]) {
    let victimIdx = -1;
    for (let i = 0; i < prev.length; i++) {
      victimIdx = i;
    }
    if (victimIdx === -1) {
      return prev;
    }
    const copy = prev.map(b => (b ? { ...b, pages: [...b.pages] } : undefined));
    copy.splice(0);
    const victim = copy[victimIdx]!;
    return victim;
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    // --- Nested matrix shape & loop construction proofs & unsafe twins ---

    test("does not flag coeffs[0]! when constructed via deterministic loop with >= 1 iterations", () => {
      const code = `
  function generateDCTCoeffs() {
    const coeffs: (number[] | undefined)[] = [];
    for (let r = 0; r < 8; r++) {
      const row: number[] = [];
      for (let c = 0; c < 8; c++) {
        row.push(c);
      }
      coeffs.push(row);
    }
    coeffs[0]![0] = 952;
    return coeffs;
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("near-miss: flags coeffs[0]! when array is declared empty without construction loop", () => {
      const code = `
  function generateDCTCoeffs() {
    const coeffs: (number[] | undefined)[] = [];
    coeffs[0]![0] = 952;
    return coeffs;
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("near-miss: flags coeffs[0]! when construction loop has 0 iterations", () => {
      const code = `
  function generateDCTCoeffs() {
    const coeffs: (number[] | undefined)[] = [];
    for (let r = 0; r < 0; r++) {
      coeffs.push([1]);
    }
    coeffs[0]![0] = 952;
    return coeffs;
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("near-miss: flags coeffs[0]! when array comes from unknown factory function", () => {
      const code = `
  declare function makeMatrix(r: number, c: number): (number[] | undefined)[];
  function generateDCTCoeffs() {
    const coeffs = makeMatrix(8, 8);
    coeffs[0]![0] = 952;
    return coeffs;
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    // --- Compound loop condition proofs & unsafe twins ---

    test("does not flag copy[ob]! in for loop with compound condition (ob < copy.length && !placed)", () => {
      const code = `
  interface Block { pages: string[]; }
  function place(copy: (Block | undefined)[], placed: boolean) {
    for (let ob = 0; ob < copy.length && !placed; ob++) {
      const other = copy[ob]!;
      return other;
    }
    return null;
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("near-miss: flags copy[ob]! in compound loop condition indexing different array", () => {
      const code = `
  interface Block { pages: string[]; }
  function place(copy: (Block | undefined)[], other: (Block | undefined)[], placed: boolean) {
    for (let ob = 0; ob < other.length && !placed; ob++) {
      const item = copy[ob]!;
      return item;
    }
    return null;
  }
      `.trim();

      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    // --- Fixed-length equality & comparison guard proofs and unsafe twins ---

    test("does not flag arr[0]! and arr[1]! when guarded by arr.length === 2", () => {
      const code = `
  function processPair(arr: (string | undefined)[]) {
    if (arr.length === 2) {
      const a = arr[0]!;
      const b = arr[1]!;
      return [a, b];
    }
    return null;
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("does not flag arr[0]! and arr[1]! when guarded by arr.length >= 2", () => {
      const code = `
  function processPair(arr: (string | undefined)[]) {
    if (arr.length >= 2) {
      const a = arr[0]!;
      const b = arr[1]!;
      return [a, b];
    }
    return null;
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("does not flag arr[0]! when guarded by arr.length > 0", () => {
      const code = `
  function processFirst(arr: (string | undefined)[]) {
    if (arr.length > 0) {
      const a = arr[0]!;
      return a;
    }
    return null;
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("does not flag sliceArgs[0]! and sliceArgs[1]! on NodeArray when guarded by length === 2", () => {
      const code = `
  interface NodeArray<T> extends ReadonlyArray<T> { readonly pos: number; }
  declare const sliceArgs: NodeArray<{ text: string } | undefined>;
  function checkArgs() {
    if (sliceArgs.length === 2) {
      const arg0 = sliceArgs[0]!;
      const arg1 = sliceArgs[1]!;
      return { arg0, arg1 };
    }
    return null;
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("does not flag arr[0]! and arr[1]! when guarded by dominating exit guard arr.length !== 2", () => {
      const code = `
  function processPair(arr: (string | undefined)[]) {
    if (arr.length !== 2) return null;
    const a = arr[0]!;
    const b = arr[1]!;
    return [a, b];
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("does not flag arr[0]! and arr[1]! when guarded by dominating exit guard arr.length < 2", () => {
      const code = `
  function processPair(arr: (string | undefined)[]) {
    if (arr.length < 2) return null;
    const a = arr[0]!;
    const b = arr[1]!;
    return [a, b];
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("near-miss: flags arr[2]! when guarded by arr.length === 2", () => {
      const code = `
  function processThird(arr: (string | undefined)[]) {
    if (arr.length === 2) {
      const c = arr[2]!;
      return c;
    }
    return null;
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("near-miss: flags arr[1]! when guarded by arr.length > 0", () => {
      const code = `
  function processSecond(arr: (string | undefined)[]) {
    if (arr.length > 0) {
      const b = arr[1]!;
      return b;
    }
    return null;
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("near-miss: flags arr[1]! when array is mutated (pop) after length === 2 guard", () => {
      const code = `
  function processMutated(arr: (string | undefined)[]) {
    if (arr.length === 2) {
      arr.pop();
      const b = arr[1]!;
      return b;
    }
    return null;
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("near-miss: flags arr[1]! when condition && arr.length === 2 is not on dominating path", () => {
      const code = `
  function processNonDominating(arr: (string | undefined)[], condition: boolean) {
    if (condition && arr.length === 2) {
      console.log("valid");
    }
    const b = arr[1]!;
    return b;
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("near-miss: flags arr[2]! when guarded by dominating exit guard arr.length !== 2", () => {
      const code = `
  function processPair(arr: (string | undefined)[]) {
    if (arr.length !== 2) return null;
    const c = arr[2]!;
    return c;
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    // --- Array.prototype.map/forEach 3rd-parameter receiver identity & unsafe twins ---

    test("does not flag array[i + 1]! inside arr.map with 3rd param when guarded by if (i < array.length - 1)", () => {
      const code = `
  const arr: ({ val: number } | undefined)[] = [{ val: 1 }, { val: 2 }, { val: 3 }];
  function mapItems() {
    return arr.map((item, i, array) => {
      if (i < array.length - 1) {
        return array[i + 1]!;
      }
      return null;
    });
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("does not flag array[i + 1]! inside arr.forEach with 3rd param when guarded by if (i < array.length - 1)", () => {
      const code = `
  const arr: ({ val: number } | undefined)[] = [{ val: 1 }, { val: 2 }, { val: 3 }];
  declare function use(item: { val: number }): void;
  function forEachItems() {
    arr.forEach((item, i, array) => {
      if (i < array.length - 1) {
        use(array[i + 1]!);
      }
    });
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("does not flag array[i + 1]! inside arr.map with 3rd param when guarded by JSX logical AND (i < array.length - 1 && ...)", () => {
      const code = `
  const arr: ({ val: number } | undefined)[] = [{ val: 1 }, { val: 2 }, { val: 3 }];
  declare function render(item: { val: number }): string;
  function renderItems() {
    return arr.map((item, i, array) => (
      i < array.length - 1 && render(array[i + 1]!)
    ));
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("does not flag array[i + 1]! inside arr.map when guard references arr.length - 1", () => {
      const code = `
  const arr: ({ val: number } | undefined)[] = [{ val: 1 }, { val: 2 }];
  function mapItems() {
    return arr.map((item, i, array) => {
      if (i < arr.length - 1) {
        return array[i + 1]!;
      }
      return null;
    });
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("does not flag arr[i + 1]! inside arr.map when guard references array.length - 1", () => {
      const code = `
  const arr: ({ val: number } | undefined)[] = [{ val: 1 }, { val: 2 }];
  function mapItems() {
    return arr.map((item, i, array) => {
      if (i < array.length - 1) {
        return arr[i + 1]!;
      }
      return null;
    });
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("does not flag array[i]! (offset 0) inside arr.map with 3rd param array", () => {
      const code = `
  const arr: ({ val: number } | undefined)[] = [{ val: 1 }, { val: 2 }];
  function mapItems() {
    return arr.map((item, i, array) => array[i]!);
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("does not flag array[index + 1]! inside array literal .map callback guarded by index < array.length - 1 (debtman pattern)", () => {
      const code = `
  function renderDiagram() {
    return [
      { key: 'a', x: 10 },
      { key: 'b', x: 20 },
      { key: 'c', x: 30 },
    ].map((node, index, array) => (
      index < array.length - 1 && array[index + 1]!.x
    ));
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("does not flag array[i + 1]! inside arr.map when guarded by early exit if (i >= array.length - 1) return", () => {
      const code = `
  const arr: ({ val: number } | undefined)[] = [{ val: 1 }, { val: 2 }];
  function mapItems() {
    return arr.map((item, i, array) => {
      if (i >= array.length - 1) return null;
      return array[i + 1]!;
    });
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("near-miss: flags other[i + 1]! inside arr.map with 3rd param array", () => {
      const code = `
  const arr: ({ val: number } | undefined)[] = [{ val: 1 }, { val: 2 }];
  const other: ({ val: number } | undefined)[] = [{ val: 10 }];
  function mapItems() {
    return arr.map((item, i, array) => {
      if (i < array.length - 1) {
        return other[i + 1]!;
      }
      return null;
    });
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("near-miss: flags array[i + 1]! inside arr.map when unguarded", () => {
      const code = `
  const arr: ({ val: number } | undefined)[] = [{ val: 1 }, { val: 2 }];
  function mapItems() {
    return arr.map((item, i, array) => array[i + 1]!);
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("near-miss: flags array[i + 1]! inside arr.map when array is mutated (pop) before access", () => {
      const code = `
  const arr: ({ val: number } | undefined)[] = [{ val: 1 }, { val: 2 }];
  function mapItems() {
    return arr.map((item, i, array) => {
      if (i < array.length - 1) {
        array.pop();
        return array[i + 1]!;
      }
      return null;
    });
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("near-miss: flags customMap callback accessing array[i + 1]! (no Array.prototype semantics)", () => {
      const code = `
  declare function customMap<T, R>(fn: (item: T, i: number, array: (T | undefined)[]) => R): R[];
  function mapCustom() {
    return customMap((item: { val: number }, i, array) => {
      if (i < array.length - 1) {
        return array[i + 1]!;
      }
      return null;
    });
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("near-miss: flags fake.map callback accessing array[i + 1]! (non-array object)", () => {
      const code = `
  const fake = {
    map<R>(fn: (item: { val: number }, i: number, array: ({ val: number } | undefined)[]) => R): R[] {
      return [];
    }
  };
  function mapFake() {
    return fake.map((item, i, array) => {
      if (i < array.length - 1) {
        return array[i + 1]!;
      }
      return null;
    });
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("does not flag non-null assertion when dominating guard is not reassigned", () => {
      const code = `
  function f(value: { name: string } | null) {
    if (!value) return;
    const n = value!.name;
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("flags non-null assertion when variable is reassigned after dominating guard", () => {
      const code = `
  declare function getNullable(): { name: string } | null;
  function f(value: { name: string } | null) {
    if (!value) return;
    value = getNullable();
    const n = value!.name;
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("flags non-null assertion when variable is nullish-assigned after dominating guard", () => {
      const code = `
  declare function getNullable(): { name: string } | null;
  function f(value: { name: string } | null) {
    if (!value) return;
    value ??= getNullable();
    const n = value!.name;
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("does not flag non-null assertion when shadow declaration in nested scope uses same name", () => {
      const code = `
  declare function getNullable(): { name: string } | null;
  function f(value: { name: string } | null) {
    if (!value) return;
    {
      const value = getNullable();
    }
    const n = value!.name;
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("does not flag copy[idx]! when copy is created via zero-argument slice()", () => {
      const code = `
  const prev: ({ name: string } | undefined)[] = [{ name: "a" }, { name: "b" }];
  function testSlice() {
    let victimIdx = -1;
    for (let i = 0; i < prev.length; i++) {
      if (prev[i]?.name === "b") {
        victimIdx = i;
        break;
      }
    }
    if (victimIdx < 0) return null;
    const copy = prev.slice();
    return copy[victimIdx]!;
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 0);
    });

    test("flags copy[idx]! when copy is created via slice(0, 1) with trimming arguments", () => {
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
    });

    test("flags copy[idx]! when copy is created via slice(1)", () => {
      const code = `
  const prev: ({ name: string } | undefined)[] = [{ name: "a" }, { name: "b" }, { name: "c" }];
  function testSlice() {
    let victimIdx = -1;
    for (let i = 0; i < prev.length; i++) {
      if (prev[i]?.name === "a") {
        victimIdx = i;
        break;
      }
    }
    if (victimIdx < 0) return null;
    const copy = prev.slice(1);
    return copy[victimIdx]!;
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("flags copy[idx]! when copy is created via slice(0, dynamicEnd)", () => {
      const code = `
  const prev: ({ name: string } | undefined)[] = [{ name: "a" }, { name: "b" }];
  function testSlice(dynamicEnd: number) {
    let victimIdx = -1;
    for (let i = 0; i < prev.length; i++) {
      if (prev[i]?.name === "b") {
        victimIdx = i;
        break;
      }
    }
    if (victimIdx < 0) return null;
    const copy = prev.slice(0, dynamicEnd);
    return copy[victimIdx]!;
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("flags React state indexing when functional updater returns large out-of-bounds literal", () => {
      const code = `
  import { useState } from 'react';
  const STEPS: ({ title: string } | undefined)[] = [
    { title: 'Step 1' },
    { title: 'Step 2' },
  ];
  function Component() {
    const [step, setStep] = useState(0);
    const current = STEPS[step]!;
    const jump = () => setStep(() => 99999);
    return null;
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("flags React state indexing when functional updater adds unconstrained step", () => {
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
    });

    test("flags React state indexing when setter uses external binary expression", () => {
      const code = `
  import { useState } from 'react';
  const STEPS: ({ title: string } | undefined)[] = [
    { title: 'Step 1' },
    { title: 'Step 2' },
  ];
  function Component(props: { offset: number }) {
    const [step, setStep] = useState(0);
    const current = STEPS[step]!;
    const jump = () => setStep(step + props.offset);
    return null;
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });

    test("flags React state indexing when custom local function is named useState", () => {
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
    });

    test("flags React state indexing when setter is called with misleading condition like target.length === 0", () => {
      const code = `
  import { useState } from 'react';
  const STEPS: ({ title: string } | undefined)[] = [
    { title: 'Step 1' },
    { title: 'Step 2' },
  ];
  function Component() {
    const [step, setStep] = useState(0);
    const current = STEPS[step]!;
    const jump = (target: string) => {
      if (target.length === 0) {
        setStep(target as any);
      }
    };
    return null;
  }
      `.trim();
      const findings = runRuleOnCode(nonNullAssertionRiskRule, code);
      assert.equal(findings.length, 1);
    });
});
