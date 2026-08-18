import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createStyler } from "../../src/core/terminal.js";

describe("terminal styler and color policy", () => {
  test("wraps text in ANSI escapes when color is enabled", () => {
    const styler = createStyler({ color: true });
    assert.equal(styler.enabled, true);
    assert.equal(styler.red("error"), "\u001B[31merror\u001B[39m");
    assert.equal(styler.bold("alert"), "\u001B[1malert\u001B[22m");
    assert.equal(styler.yellow("warning"), "\u001B[33mwarning\u001B[39m");
  });

  test("returns verbatim plain text when color is disabled", () => {
    const styler = createStyler({ color: false });
    assert.equal(styler.enabled, false);
    assert.equal(styler.red("error"), "error");
    assert.equal(styler.bold("alert"), "alert");
    assert.equal(styler.yellow("warning"), "warning");
    assert.equal(styler.dim("details"), "details");
  });

  test("handles empty strings safely", () => {
    const styler = createStyler({ color: true });
    assert.equal(styler.red(""), "");
    assert.equal(styler.bold(""), "");
  });
});
