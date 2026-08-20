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
  declare function useState<T>(init: T): [T, (val: T | ((prev: T) => T)) => void];

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
  declare function useState<T>(init: T): [T, (val: T) => void];

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
  declare function useState<T>(init: T): [T, (val: T) => void];

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
  declare function useState<T>(init: T): [T, (val: T) => void];

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
});
