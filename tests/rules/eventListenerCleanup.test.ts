import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { eventListenerCleanupRule } from "../../src/rules/browser/eventListenerCleanup.js";
import { runRuleOnCode } from "./ruleTestUtils.js";

describe("rule browser/event-listener-cleanup", () => {
  test("flags addEventListener in useEffect without returned cleanup", () => {
    const code = `
import { useEffect } from 'react';

function MyComponent() {
  useEffect(() => {
    const onResize = () => {};
    window.addEventListener('resize', onResize);
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(eventListenerCleanupRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "browser/event-listener-cleanup");
    assert.equal(findings[0]?.severity, "error");
    assert.equal(findings[0]?.confidence, "high");
  });

  test("flags addEventListener when inline arrow functions are used (reference mismatch)", () => {
    const code = `
import { useEffect } from 'react';

function MyComponent() {
  useEffect(() => {
    window.addEventListener('resize', () => console.log('resize'));
    return () => {
      window.removeEventListener('resize', () => console.log('resize'));
    };
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(eventListenerCleanupRule, code);
    assert.equal(findings.length, 1);
    assert.ok(findings[0]?.evidence[0]?.message.includes("Inline callback function"));
  });

  test("does not flag properly matched named handler cleanup", () => {
    const code = `
import { useEffect } from 'react';

function MyComponent() {
  useEffect(() => {
    function handleResize() {}
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(eventListenerCleanupRule, code);
    assert.equal(findings.length, 0);
  });
  test("does not flag custom non-DOM event emitter addEventListener", () => {
    const code = `
import { useEffect } from 'react';

class CustomEventEmitter {
  addEventListener(name: string, cb: () => void) {}
}

function MyComponent() {
  useEffect(() => {
    const emitter = new CustomEventEmitter();
    emitter.addEventListener('change', () => {});
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(eventListenerCleanupRule, code);
    assert.equal(findings.length, 0, "Custom emitter addEventListener should not trigger DOM event listener warning");
  });

  test("flags uncleaned addEventListener on document and DOM element", () => {
    const code = `
import { useEffect } from 'react';

function MyComponent({ element }: { element: HTMLElement }) {
  useEffect(() => {
    const onClick = () => {};
    document.addEventListener('click', onClick);
    element.addEventListener('scroll', onClick);
  }, [element]);
}
    `.trim();

    const findings = runRuleOnCode(eventListenerCleanupRule, code);
    assert.equal(findings.length, 2, "DOM document and element addEventListener must be flagged when uncleaned");
  });

  test("does not flag addEventListener cleaned up via AbortController.abort()", () => {
    const code = `
import { useEffect } from 'react';

function AbortComponent() {
  useEffect(() => {
    const controller = new AbortController();
    window.addEventListener('resize', () => {}, { signal: controller.signal });
    return () => {
      controller.abort();
    };
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(eventListenerCleanupRule, code);
    assert.equal(findings.length, 0, "controller.abort() cleans up listener with controller.signal");
  });

  test("flags addEventListener with controller.signal when abort() is never called", () => {
    const code = `
import { useEffect } from 'react';

function MissingAbortComponent() {
  useEffect(() => {
    const controller = new AbortController();
    window.addEventListener('resize', () => {}, { signal: controller.signal });
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(eventListenerCleanupRule, code);
    assert.equal(findings.length, 1, "Un-aborted controller listener must be flagged");
  });

  test("flags listener when two controllers exist and the wrong one is aborted", () => {
    const code = `
import { useEffect } from 'react';

function WrongAbortComponent() {
  useEffect(() => {
    const controller1 = new AbortController();
    const controller2 = new AbortController();
    window.addEventListener('resize', () => {}, { signal: controller1.signal });
    return () => {
      controller2.abort(); // Aborted wrong controller!
    };
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(eventListenerCleanupRule, code);
    assert.equal(findings.length, 1, "Aborting wrong controller must leave listener flagged");
  });

  test("does not flag listener using signal variable alias when controller is aborted", () => {
    const code = `
import { useEffect } from 'react';

function AliasedSignalComponent() {
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    window.addEventListener('resize', () => {}, { signal });
    return () => {
      controller.abort();
    };
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(eventListenerCleanupRule, code);
    assert.equal(findings.length, 0, "Signal variable alias with controller.abort() should be recognized");
  });

  test("flags listener using custom non-DOM object with signal/abort properties", () => {
    const code = `
import { useEffect } from 'react';

function CustomSignalComponent() {
  useEffect(() => {
    const custom = { signal: {} as unknown as AbortSignal, abort: () => {} };
    window.addEventListener('resize', () => {}, { signal: custom.signal });
    return () => {
      custom.abort();
    };
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(eventListenerCleanupRule, code);
    assert.equal(findings.length, 1, "Custom object with signal property is not an authentic AbortController");
  });
});
