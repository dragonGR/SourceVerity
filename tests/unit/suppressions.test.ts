import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseSourceSuppressions, isFindingSuppressed } from "../../src/core/suppressions.js";
import type { Finding } from "../../src/core/types.js";

describe("source code suppression parser and evaluator", () => {
  test("parses next-line suppression comments with optional reasons", () => {
    const source = `
const a = 1;
// sourceverity-disable-next-line typescript/unsafe-unvalidated-assertion -- validated by API
const user = JSON.parse(payload) as User;
    `.trim();

    const supp = parseSourceSuppressions(source);
    assert.equal(supp.nextLineSuppressions.length, 1);
    assert.equal(supp.nextLineSuppressions[0]?.line, 3);
    assert.deepEqual(supp.nextLineSuppressions[0]?.ruleIds, ["typescript/unsafe-unvalidated-assertion"]);
    assert.equal(supp.nextLineSuppressions[0]?.reason, "validated by API");
  });

  test("parses multiple comma-separated rule suppressions on single line", () => {
    const source = `
// sourceverity-disable-next-line async/floating-promise, async/async-foreach
items.forEach(async (item) => {});
    `.trim();

    const supp = parseSourceSuppressions(source);
    assert.equal(supp.nextLineSuppressions.length, 1);
    assert.deepEqual(supp.nextLineSuppressions[0]?.ruleIds, ["async/floating-promise", "async/async-foreach"]);
  });

  test("parses block suppression regions with enable/disable boundaries", () => {
    const source = `
/* sourceverity-disable react/derived-state-effect */
useEffect(() => { setState(x); });
useEffect(() => { setState(y); });
/* sourceverity-enable react/derived-state-effect */
useEffect(() => { setState(z); });
    `.trim();

    const supp = parseSourceSuppressions(source);
    assert.equal(supp.blockSuppressions.length, 1);
    assert.equal(supp.blockSuppressions[0]?.startLine, 1);
    assert.equal(supp.blockSuppressions[0]?.endLine, 4);
  });

  test("correctly suppresses matching finding and ignores non-matching", () => {
    const source = `
// sourceverity-disable-next-line async/floating-promise
fireAndForget();
    `.trim();

    const supp = parseSourceSuppressions(source);

    const matchingFinding: Finding = {
      fingerprint: "sv_123",
      ruleId: "async/floating-promise",
      category: "async",
      severity: "error",
      confidence: "high",
      message: "unhandled promise",
      file: "test.ts",
      range: { start: { line: 2, column: 1 }, end: { line: 2, column: 15 } },
      evidence: [],
      safeAutomaticFix: false,
    };

    const differentRuleFinding: Finding = {
      ...matchingFinding,
      ruleId: "typescript/non-null-assertion-risk",
    };

    assert.equal(isFindingSuppressed(matchingFinding, supp), true);
    assert.equal(isFindingSuppressed(differentRuleFinding, supp), false);
  });
});
