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

  test("does not flag constant event expression cleanup (EVENT ↔ EVENT)", () => {
    const code = `
import { useEffect } from 'react';

const EVENT = "open-settings";

function SettingsComponent() {
  useEffect(() => {
    const handler = () => {};

    window.addEventListener(EVENT, handler);

    return () => {
      window.removeEventListener(EVENT, handler);
    };
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(eventListenerCleanupRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag aliased constant event expression (const EVENT_ALIAS = EVENT)", () => {
    const code = `
import { useEffect } from 'react';

const EVENT = "click";
const EVENT_ALIAS = EVENT;

function ClickComponent() {
  useEffect(() => {
    const handler = () => {};
    window.addEventListener(EVENT_ALIAS, handler);
    return () => {
      window.removeEventListener(EVENT, handler);
    };
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(eventListenerCleanupRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag real-world OPEN_COOKIE_SETTINGS_EVENT paired listener cleanup", () => {
    const code = `
import { useEffect } from 'react';

const OPEN_COOKIE_SETTINGS_EVENT = "open-cookie-settings";

function CookieBanner() {
  useEffect(() => {
    const openSettings = () => {};

    window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, openSettings);

    return () => {
      window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, openSettings);
    };
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(eventListenerCleanupRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag two independent React effects using the same constant", () => {
    const code = `
import { useEffect } from 'react';

const EVENT = "resize";

function MultiEffectComponent() {
  useEffect(() => {
    const handleFirst = () => {};
    window.addEventListener(EVENT, handleFirst);
    return () => {
      window.removeEventListener(EVENT, handleFirst);
    };
  }, []);

  useEffect(() => {
    const handleSecond = () => {};
    window.addEventListener(EVENT, handleSecond);
    return () => {
      window.removeEventListener(EVENT, handleSecond);
    };
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(eventListenerCleanupRule, code);
    assert.equal(findings.length, 0);
  });

  test("flags mismatched constant event expressions (EVENT_A vs EVENT_B)", () => {
    const code = `
import { useEffect } from 'react';

const EVENT_A = "click";
const EVENT_B = "keydown";

function MismatchComponent() {
  useEffect(() => {
    const handler = () => {};
    window.addEventListener(EVENT_A, handler);
    return () => {
      window.removeEventListener(EVENT_B, handler);
    };
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(eventListenerCleanupRule, code);
    assert.equal(findings.length, 1);
    assert.ok(findings[0]?.message.includes("click") || findings[0]?.message.includes("EVENT_A"));
  });

  test("flags handler mismatch when using constant event expression", () => {
    const code = `
import { useEffect } from 'react';

const EVENT = "click";

function HandlerMismatchComponent() {
  useEffect(() => {
    const handler1 = () => {};
    const handler2 = () => {};
    window.addEventListener(EVENT, handler1);
    return () => {
      window.removeEventListener(EVENT, handler2);
    };
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(eventListenerCleanupRule, code);
    assert.equal(findings.length, 1);
  });
});
