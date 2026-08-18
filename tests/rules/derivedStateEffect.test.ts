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

  test("does not flag state reset triggered by dependency change (setMessageIndex(0))", () => {
    const code = `
import { useEffect, useState } from 'react';

function Scanner({ isScanning }: { isScanning: boolean }) {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    setMessageIndex(0);
  }, [isScanning]);

  return <div>{messageIndex}</div>;
}
    `.trim();

    const findings = runRuleOnCode(derivedStateEffectRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag state reset with named default constant", () => {
    const code = `
import { useEffect, useState } from 'react';

const DEFAULT_STATE = { count: 0 };
function Component({ activeTab }: { activeTab: string }) {
  const [state, setState] = useState(DEFAULT_STATE);

  useEffect(() => {
    setState(DEFAULT_STATE);
  }, [activeTab]);

  return <div>{state.count}</div>;
}
    `.trim();

    const findings = runRuleOnCode(derivedStateEffectRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag functional state updater callback (prev => ...)", () => {
    const code = `
import { useEffect, useState } from 'react';

function Counter({ trigger }: { trigger: number }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount((prev) => prev + 1);
  }, [trigger]);

  return <div>{count}</div>;
}
    `.trim();

    const findings = runRuleOnCode(derivedStateEffectRule, code);
    assert.equal(findings.length, 0);
  });

  test("flags derived state computed through helper function of prop", () => {
    const code = `
import { useEffect, useState } from 'react';
declare function formatUnits(val: bigint, decimals: number): string;

function Balance({ amountWei }: { amountWei: bigint }) {
  const [topUpAmount, setTopUpAmount] = useState('');

  useEffect(() => {
    setTopUpAmount(amountWei > 0n ? formatUnits(amountWei, 18) : '');
  }, [amountWei]);

  return <div>{topUpAmount}</div>;
}
    `.trim();

    const findings = runRuleOnCode(derivedStateEffectRule, code);
    assert.equal(findings.length, 1);
  });
});
