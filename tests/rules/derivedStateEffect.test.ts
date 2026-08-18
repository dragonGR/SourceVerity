import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { derivedStateEffectRule } from "../../src/rules/react/derivedStateEffect.js";
import { runRuleOnCode } from "./ruleTestUtils.js";

describe("rule react/derived-state-effect", () => {
  test("flags useEffect used solely to derive state", () => {
    const code = `
import { useEffect, useState } from 'react';

function NameDisplay({ firstName, lastName }: { firstName: string; lastName: string }) {
  const [fullName, setFullName] = useState('');

  useEffect(() => {
    setFullName(firstName + ' ' + lastName);
  }, [firstName, lastName]);

  return <div>{fullName}</div>;
}
    `.trim();

    const findings = runRuleOnCode(derivedStateEffectRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "react/derived-state-effect");
    assert.equal(findings[0]?.severity, "warning");
    assert.equal(findings[0]?.confidence, "high");
  });

  test("does not flag effect with external side-effects or network calls", () => {
    const code = `
import { useEffect, useState } from 'react';

function UserView({ userId }: { userId: string }) {
  const [user, setUser] = useState(null);

  useEffect(() => {
    fetch('/api/users/' + userId).then((r) => r.json()).then((data) => setUser(data));
  }, [userId]);

  return <div>{user}</div>;
}
    `.trim();

    const findings = runRuleOnCode(derivedStateEffectRule, code);
    assert.equal(findings.length, 0);
  });
});
