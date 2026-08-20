import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { timerCleanupRule } from "../../src/rules/browser/timerCleanup.js";
import { runRuleOnCode } from "./ruleTestUtils.js";

describe("rule browser/timer-cleanup", () => {
  test("flags setInterval without matching clearInterval in useEffect", () => {
    const code = `
import { useEffect } from 'react';

function TimerComponent() {
  useEffect(() => {
    const id = setInterval(() => {
      console.log('tick');
    }, 1000);
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(timerCleanupRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "browser/timer-cleanup");
    assert.equal(findings[0]?.severity, "error");
    assert.equal(findings[0]?.confidence, "high");
    assert.equal(
      findings[0]?.message,
      "setInterval registered in lifecycle hook is missing matching clearInterval cleanup."
    );
    assert.equal(
      findings[0]?.evidence[0]?.message,
      "An uncleared interval continues executing after the owning component has unmounted, retaining its callback and performing unnecessary background work."
    );
    assert.equal(
      findings[0]?.suggestedAction,
      "Clear the interval in the returned cleanup function: return () => clearInterval(id);"
    );

    // Verify diagnostic does not overclaim state/memory leaks
    const evidenceText = findings[0]?.evidence[0]?.message ?? "";
    assert.doesNotMatch(evidenceText, /memory leak/i);
    assert.doesNotMatch(evidenceText, /state leak/i);
    assert.doesNotMatch(evidenceText, /CPU consumption/i);
  });

  test("does not flag setInterval with matching clearInterval in cleanup", () => {
    const code = `
import { useEffect } from 'react';

function TimerComponent() {
  useEffect(() => {
    const id = setInterval(() => {
      console.log('tick');
    }, 1000);
    return () => clearInterval(id);
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(timerCleanupRule, code);
    assert.equal(findings.length, 0);
  });

  test("flags setInterval when wrong cleanup function (clearTimeout) is used", () => {
    const code = `
import { useEffect } from 'react';

function TimerComponent() {
  useEffect(() => {
    const id = setInterval(() => {
      console.log('tick');
    }, 1000);
    return () => clearTimeout(id);
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(timerCleanupRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.severity, "error");
    assert.equal(findings[0]?.confidence, "high");
  });

  test("flags setInterval in useLayoutEffect without cleanup", () => {
    const code = `
import { useLayoutEffect } from 'react';

function LayoutComponent() {
  useLayoutEffect(() => {
    const pollId = setInterval(() => {
      console.log('poll');
    }, 2000);
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(timerCleanupRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.severity, "error");
    assert.equal(findings[0]?.confidence, "high");
    assert.equal(
      findings[0]?.evidence[0]?.message,
      "An uncleared interval continues executing after the owning component has unmounted, retaining its callback and performing unnecessary background work."
    );
    assert.equal(
      findings[0]?.suggestedAction,
      "Clear the interval in the returned cleanup function: return () => clearInterval(pollId);"
    );
  });

  test("flags setTimeout without clearTimeout as warning with restrained evidence", () => {
    const code = `
import { useEffect } from 'react';

function DelayComponent() {
  useEffect(() => {
    setTimeout(() => {
      console.log('delayed');
    }, 500);
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(timerCleanupRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.ruleId, "browser/timer-cleanup");
    assert.equal(findings[0]?.severity, "warning");
    assert.equal(findings[0]?.confidence, "medium");
    assert.equal(
      findings[0]?.message,
      "setTimeout registered in lifecycle hook is missing matching clearTimeout cleanup."
    );
    assert.equal(
      findings[0]?.evidence[0]?.message,
      "A pending timeout may fire after the component has unmounted and execute stale lifecycle work."
    );
    assert.equal(
      findings[0]?.suggestedAction,
      "Store the timeout handle and clear it in the effect cleanup when post-unmount execution is not intended."
    );

    // Verify diagnostic does not overclaim leaks or CPU consumption
    const evidenceText = findings[0]?.evidence[0]?.message ?? "";
    assert.doesNotMatch(evidenceText, /memory leak/i);
    assert.doesNotMatch(evidenceText, /state leak/i);
    assert.doesNotMatch(evidenceText, /CPU consumption/i);
  });

  test("does not flag setTimeout with matching clearTimeout in cleanup", () => {
    const code = `
import { useEffect } from 'react';

function DelayComponent() {
  useEffect(() => {
    const timerId = setTimeout(() => {
      console.log('delayed');
    }, 500);
    return () => clearTimeout(timerId);
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(timerCleanupRule, code);
    assert.equal(findings.length, 0);
  });

  test("flags setTimeout when wrong cleanup function (clearInterval) is used", () => {
    const code = `
import { useEffect } from 'react';

function DelayComponent() {
  useEffect(() => {
    const id = setTimeout(() => {
      console.log('delayed');
    }, 500);
    return () => clearInterval(id);
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(timerCleanupRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.severity, "warning");
  });

  test("flags setTimeout in useLayoutEffect without cleanup", () => {
    const code = `
import { useLayoutEffect } from 'react';

function LayoutComponent() {
  useLayoutEffect(() => {
    setTimeout(() => {
      console.log('layout delayed');
    }, 50);
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(timerCleanupRule, code);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.severity, "warning");
    assert.equal(findings[0]?.confidence, "medium");
    assert.equal(
      findings[0]?.evidence[0]?.message,
      "A pending timeout may fire after the component has unmounted and execute stale lifecycle work."
    );
  });

  test("does not flag collection of timers cleared with forEach(clearTimeout)", () => {
    const code = `
import { useEffect } from 'react';

function BootComponent() {
  useEffect(() => {
    const timers = [];
    timers.push(setTimeout(() => console.log('1'), 100));
    timers.push(setTimeout(() => console.log('2'), 200));
    return () => timers.forEach(clearTimeout);
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(timerCleanupRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag timers in for...of loop cleanup", () => {
    const code = `
import { useEffect } from 'react';

function BootComponent() {
  useEffect(() => {
    const timers = [];
    timers.push(setTimeout(() => console.log('1'), 100));
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(timerCleanupRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag timers in forEach arrow callback cleanup", () => {
    const code = `
import { useEffect } from 'react';

function BootComponent() {
  useEffect(() => {
    const timers = [];
    timers.push(setTimeout(() => console.log('1'), 100));
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(timerCleanupRule, code);
    assert.equal(findings.length, 0);
  });

  test("does not flag timers in forEach block callback cleanup", () => {
    const code = `
import { useEffect } from 'react';

function BootComponent() {
  useEffect(() => {
    const timers = [];
    timers.push(setTimeout(() => console.log('1'), 100));
    return () => {
      timers.forEach((id) => {
        clearTimeout(id);
      });
    };
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(timerCleanupRule, code);
    assert.equal(findings.length, 0);
  });

  test("near-miss: flags timers when otherTimers is cleared instead", () => {
    const code = `
import { useEffect } from 'react';

function BootComponent() {
  useEffect(() => {
    const timers = [];
    const otherTimers = [];
    timers.push(setTimeout(() => console.log('1'), 100));
    return () => otherTimers.forEach(clearTimeout);
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(timerCleanupRule, code);
    assert.equal(findings.length, 1);
  });

  test("near-miss: flags timeouts when cleared with clearInterval", () => {
    const code = `
import { useEffect } from 'react';

function BootComponent() {
  useEffect(() => {
    const timers = [];
    timers.push(setTimeout(() => console.log('1'), 100));
    return () => timers.forEach(clearInterval);
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(timerCleanupRule, code);
    assert.equal(findings.length, 1);
  });

  test("near-miss: flags timeouts when forEach calls unrelated logger", () => {
    const code = `
import { useEffect } from 'react';

function BootComponent() {
  useEffect(() => {
    const timers = [];
    timers.push(setTimeout(() => console.log('1'), 100));
    return () => timers.forEach(console.log);
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(timerCleanupRule, code);
    assert.equal(findings.length, 1);
  });

  test("near-miss: flags timers when non-timer value is pushed to the collection", () => {
    const code = `
import { useEffect } from 'react';

function BootComponent() {
  useEffect(() => {
    const timers = [];
    timers.push(setTimeout(() => console.log('1'), 100));
    timers.push("not-a-timer");
    return () => timers.forEach(clearTimeout);
  }, []);
}
    `.trim();

    const findings = runRuleOnCode(timerCleanupRule, code);
    assert.equal(findings.length, 1);
  });
});
