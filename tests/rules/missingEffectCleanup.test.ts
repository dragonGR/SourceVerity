import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { missingEffectCleanupRule } from "../../src/rules/react/missingEffectCleanup.js";
import { runRuleOnCode } from "./ruleTestUtils.js";

describe("rule react/missing-effect-cleanup", () => {
  test("flags WebSocket instantiated in useEffect without cleanup function", () => {
    const code = `
import { useEffect } from 'react';

function LiveFeed() {
  useEffect(() => {
    const socket = new WebSocket('wss://example.com');
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(missingEffectCleanupRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "react/missing-effect-cleanup");
    assert.equal(findings[0]?.severity, "warning");
    assert.equal(findings[0]?.confidence, "high");
  });

  test("does not flag WebSocket when cleanup function is returned", () => {
    const code = `
import { useEffect } from 'react';

function LiveFeed() {
  useEffect(() => {
    const socket = new WebSocket('wss://example.com');
    return () => {
      socket.close();
    };
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(missingEffectCleanupRule, code);
    assert.equal(findings.length, 0);
  });
  test("does not flag when named cleanup function is returned", () => {
    const code = `
import { useEffect } from 'react';

function LiveFeed() {
  useEffect(() => {
    const socket = new WebSocket('wss://example.com');
    function cleanup() {
      socket.close();
    }
    return cleanup;
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(missingEffectCleanupRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag when cleanup arrow function variable is returned", () => {
    const code = `
import { useEffect } from 'react';

function LiveFeed() {
  useEffect(() => {
    const socket = new WebSocket('wss://example.com');
    const cleanup = () => {
      socket.close();
    };
    return cleanup;
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(missingEffectCleanupRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag concise arrow function returning cleanup callback", () => {
    const code = `
import { useEffect } from 'react';

function LiveFeed(socket: WebSocket) {
  useEffect(() => () => socket.close(), []);
}
    `.trim();

    const findings = runRuleOnCode(missingEffectCleanupRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag conditional cleanup function return", () => {
    const code = `
import { useEffect } from 'react';

function LiveFeed(enabled: boolean) {
  useEffect(() => {
    const socket = new WebSocket('wss://example.com');
    return enabled ? () => socket.close() : undefined;
  }, [enabled]);
}
    `.trim();

    const findings = runRuleOnCode(missingEffectCleanupRule, code);
    assert.equal(findings.length, 0);
  });

  test("flags unsafe return 42 as missing cleanup", () => {
    const code = `
import { useEffect } from 'react';

function LiveFeed() {
  useEffect(() => {
    const socket = new WebSocket('wss://example.com');
    return 42;
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(missingEffectCleanupRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "react/missing-effect-cleanup");
  });

  test("flags unsafe return null as missing cleanup", () => {
    const code = `
import { useEffect } from 'react';

function LiveFeed() {
  useEffect(() => {
    const socket = new WebSocket('wss://example.com');
    return null;
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(missingEffectCleanupRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "react/missing-effect-cleanup");
  });

  test("flags unsafe return socket as missing cleanup", () => {
    const code = `
import { useEffect } from 'react';

function LiveFeed() {
  useEffect(() => {
    const socket = new WebSocket('wss://example.com');
    return socket;
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(missingEffectCleanupRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "react/missing-effect-cleanup");
  });

  test("flags unsafe return of non-callable variable as missing cleanup", () => {
    const code = `
import { useEffect } from 'react';

function LiveFeed() {
  useEffect(() => {
    const socket = new WebSocket('wss://example.com');
    const value = 123;
    return value;
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(missingEffectCleanupRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "react/missing-effect-cleanup");
  });

  test("lookalike: returns cleanup function that does not close socket (presence check satisfies contract)", () => {
    const code = `
import { useEffect } from 'react';

function LiveFeed() {
  useEffect(() => {
    const socket = new WebSocket('wss://example.com');
    function cleanup() {
      console.log('not actually closing socket');
    }
    return cleanup;
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(missingEffectCleanupRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag WebSocket inside local custom useEffect function", () => {
    const code = `
function useEffect(cb: () => void, deps?: unknown[]) {
  cb();
}
function Component() {
  useEffect(() => {
    const ws = new WebSocket('wss://api.example.com');
  });
}
    `.trim();
    const findings = runRuleOnCode(missingEffectCleanupRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag WebSocket inside local custom useLayoutEffect function", () => {
    const code = `
function useLayoutEffect(cb: () => void, deps?: unknown[]) {
  cb();
}
function Component() {
  useLayoutEffect(() => {
    const ws = new WebSocket('wss://api.example.com');
  });
}
    `.trim();
    const findings = runRuleOnCode(missingEffectCleanupRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag WebSocket inside customEffect imported from local file", () => {
    const code = `
import { useEffect as customEffect } from './local-hooks';
function Component() {
  customEffect(() => {
    const ws = new WebSocket('wss://api.example.com');
  });
}
    `.trim();
    const findings = runRuleOnCode(missingEffectCleanupRule, code);
    assert.equal(findings.length, 0);
  });

  test("flags WebSocket inside aliased React useEffect import", () => {
    const code = `
import { useEffect as effect } from 'react';
function Component() {
  effect(() => {
    const ws = new WebSocket('wss://api.example.com');
  }, []);
}
    `.trim();
    const findings = runRuleOnCode(missingEffectCleanupRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "react/missing-effect-cleanup");
  });

  test("flags WebSocket inside React.useEffect namespace call", () => {
    const code = `
import * as React from 'react';
function Component() {
  React.useEffect(() => {
    const ws = new WebSocket('wss://api.example.com');
  }, []);
}
    `.trim();
    const findings = runRuleOnCode(missingEffectCleanupRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "react/missing-effect-cleanup");
  });
});
