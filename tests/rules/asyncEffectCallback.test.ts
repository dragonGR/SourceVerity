import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { asyncEffectCallbackRule } from "../../src/rules/react/asyncEffectCallback.js";
import { runRuleOnCode } from "./ruleTestUtils.js";

describe("rule react/async-effect-callback", () => {
  test("flags direct async callback passed to useEffect", () => {
    const code = `
import { useEffect } from 'react';

function UserProfile() {
  useEffect(async () => {
    const res = await fetch('/api/user');
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(asyncEffectCallbackRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "react/async-effect-callback");
    assert.equal(findings[0]?.severity, "error");
    assert.equal(findings[0]?.confidence, "high");
  });

  test("does not flag inner async function called synchronously", () => {
    const code = `
import { useEffect } from 'react';

function UserProfile() {
  useEffect(() => {
    async function loadData() {
      await fetch('/api/user');
    }
    loadData();
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(asyncEffectCallbackRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag direct async callback passed to local custom useEffect function", () => {
    const code = `
function useEffect(cb: () => Promise<void>, deps?: unknown[]) {
  cb();
}

function Component() {
  useEffect(async () => {
    await fetch('/api/data');
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(asyncEffectCallbackRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag direct async callback passed to local custom useLayoutEffect function", () => {
    const code = `
function useLayoutEffect(cb: () => Promise<void>, deps?: unknown[]) {
  cb();
}

function Component() {
  useLayoutEffect(async () => {
    await fetch('/api/data');
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(asyncEffectCallbackRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag direct async callback passed to customEffect imported from local file", () => {
    const code = `
import { useEffect as customEffect } from "./local-hooks";

function Component() {
  customEffect(async () => {
    await fetch('/api/data');
  });
}
    `.trim();

    const findings = runRuleOnCode(asyncEffectCallbackRule, code);
    assert.equal(findings.length, 0);
  });

  test("flags direct async callback passed to aliased React useEffect import", () => {
    const code = `
import { useEffect as effect } from 'react';

function Component() {
  effect(async () => {
    await fetch('/api/data');
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(asyncEffectCallbackRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "react/async-effect-callback");
  });

  test("flags direct async callback passed to React.useEffect namespace call", () => {
    const code = `
import * as React from 'react';

function Component() {
  React.useEffect(async () => {
    await fetch('/api/data');
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(asyncEffectCallbackRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "react/async-effect-callback");
  });

  test("flags direct async callback passed to useLayoutEffect from react", () => {
    const code = `
import { useLayoutEffect } from 'react';

function Component() {
  useLayoutEffect(async () => {
    await fetch('/api/data');
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(asyncEffectCallbackRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "react/async-effect-callback");
  });

  test("does not flag direct async callback passed to useCallback from react", () => {
    const code = `
import { useCallback } from 'react';
function Component() {
  const cb = useCallback(async () => {
    await fetch('/api/data');
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(asyncEffectCallbackRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag direct async callback passed to aliased React useCallback import", () => {
    const code = `
import { useCallback as cb } from 'react';
function Component() {
  const handler = cb(async () => {
    await fetch('/api/data');
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(asyncEffectCallbackRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag direct async callback passed to React.useCallback namespace call", () => {
    const code = `
import * as React from 'react';
function Component() {
  const handler = React.useCallback(async () => {
    await fetch('/api/data');
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(asyncEffectCallbackRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag direct async callback passed to useMemo from react", () => {
    const code = `
import { useMemo } from 'react';
function Component() {
  const data = useMemo(async () => {
    return await fetch('/api/data');
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(asyncEffectCallbackRule, code);
    assert.equal(findings.length, 0);
  });
});
