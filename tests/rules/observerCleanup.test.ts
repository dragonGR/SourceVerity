import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { observerCleanupRule } from "../../src/rules/browser/observerCleanup.js";
import { runRuleOnCode } from "./ruleTestUtils.js";

describe("rule browser/observer-cleanup", () => {
  test("flags ResizeObserver without disconnect in useEffect", () => {
    const code = `
import { useEffect } from 'react';

function ObserverComponent() {
  useEffect(() => {
    const ro = new ResizeObserver(() => {});
    ro.observe(document.body);
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(observerCleanupRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "browser/observer-cleanup");
    assert.equal(findings[0]?.severity, "error");
    assert.equal(findings[0]?.confidence, "high");
  });

  test("does not flag ResizeObserver when disconnect is called in cleanup", () => {
    const code = `
import { useEffect } from 'react';

function ObserverComponent() {
  useEffect(() => {
    const ro = new ResizeObserver(() => {});
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(observerCleanupRule, code);
    assert.equal(findings.length, 0);
  });

  test("flags IntersectionObserver without disconnect", () => {
    const code = `
import { useEffect } from 'react';

function LazyImage() {
  useEffect(() => {
    const io = new IntersectionObserver(() => {});
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(observerCleanupRule, code);
    assert.equal(findings.length, 1);
  });

  test("does not flag when two observers are both disconnected", () => {
    const code = `
import { useEffect } from 'react';

function DualObserverComponent() {
  useEffect(() => {
    const ro = new ResizeObserver(() => {});
    const mo = new MutationObserver(() => {});
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(observerCleanupRule, code);
    assert.equal(findings.length, 0, "Both disconnected observers should produce 0 findings");
  });

  test("flags only the second observer when only the first is disconnected", () => {
    const code = `
import { useEffect } from 'react';

function PartialComponent() {
  useEffect(() => {
    const ro1 = new ResizeObserver(() => {});
    const mo2 = new MutationObserver(() => {});
    return () => {
      ro1.disconnect();
    };
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(observerCleanupRule, code);
    assert.equal(findings.length, 1);
    assert.ok(findings[0]?.message.includes("MutationObserver"));
    assert.ok(findings[0]?.evidence[0]?.message.includes("mo2"));
  });

  test("flags only the first observer when only the second is disconnected", () => {
    const code = `
import { useEffect } from 'react';

function PartialComponent() {
  useEffect(() => {
    const ro1 = new ResizeObserver(() => {});
    const ro2 = new ResizeObserver(() => {});
    return () => {
      ro2.disconnect();
    };
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(observerCleanupRule, code);
    assert.equal(findings.length, 1);
    assert.ok(findings[0]?.evidence[0]?.message.includes("ro1"));
  });

  test("recognizes aliased observer disconnected in cleanup", () => {
    const code = `
import { useEffect } from 'react';

function AliasedObserver() {
  useEffect(() => {
    const ro = new ResizeObserver(() => {});
    const cleanupRef = ro;
    return () => {
      cleanupRef.disconnect();
    };
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(observerCleanupRule, code);
    assert.equal(findings.length, 0, "Aliased observer disconnect should be recognized");
  });

  test("does not flag custom non-DOM class named ResizeObserver", () => {
    const code = `
import { useEffect } from 'react';

class ResizeObserver {
  observe() {}
}

function CustomObserverComponent() {
  useEffect(() => {
    const ro = new ResizeObserver();
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(observerCleanupRule, code);
    assert.equal(findings.length, 0, "Custom class ResizeObserver should not be mistaken for DOM observer");
  });

  test("does not flag ResizeObserver inside local custom useEffect function", () => {
    const code = `
function useEffect(cb: () => void, deps?: unknown[]) {
  cb();
}
function Component() {
  useEffect(() => {
    const ro = new ResizeObserver(() => {});
  });
}
    `.trim();
    const findings = runRuleOnCode(observerCleanupRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag ResizeObserver inside local custom useLayoutEffect function", () => {
    const code = `
function useLayoutEffect(cb: () => void, deps?: unknown[]) {
  cb();
}
function Component() {
  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => {});
  });
}
    `.trim();
    const findings = runRuleOnCode(observerCleanupRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag ResizeObserver inside customEffect imported from local file", () => {
    const code = `
import { useEffect as customEffect } from './local-hooks';
function Component() {
  customEffect(() => {
    const ro = new ResizeObserver(() => {});
  });
}
    `.trim();
    const findings = runRuleOnCode(observerCleanupRule, code);
    assert.equal(findings.length, 0);
  });

  test("flags ResizeObserver inside aliased React useEffect import", () => {
    const code = `
import { useEffect as effect } from 'react';
function Component() {
  effect(() => {
    const ro = new ResizeObserver(() => {});
  }, []);
}
    `.trim();
    const findings = runRuleOnCode(observerCleanupRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "browser/observer-cleanup");
  });

  test("flags ResizeObserver inside React.useEffect namespace call", () => {
    const code = `
import * as React from 'react';
function Component() {
  React.useEffect(() => {
    const ro = new ResizeObserver(() => {});
  }, []);
}
    `.trim();
    const findings = runRuleOnCode(observerCleanupRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "browser/observer-cleanup");
  });
});
