import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizePath } from "../../src/core/paths.js";

describe("paths normalization and detection", () => {
  test("normalizes windows backslashes to posix forward slashes", () => {
    assert.equal(normalizePath("src\\components\\Button.tsx"), "src/components/Button.tsx");
    assert.equal(normalizePath("nested\\dir\\file.ts"), "nested/dir/file.ts");
  });

  test("removes leading ./ and duplicate slashes", () => {
    assert.equal(normalizePath("./src/api/user.ts"), "src/api/user.ts");
    assert.equal(normalizePath("src//api///user.ts"), "src/api/user.ts");
  });

  test("normalizes absolute paths relative to given root", () => {
    const root = process.platform === "win32" ? "C:\\repo" : "/workspace/repo";
    const target = process.platform === "win32" ? "C:\\repo\\apps\\web\\src\\index.ts" : "/workspace/repo/apps/web/src/index.ts";
    assert.equal(normalizePath(target, root), "apps/web/src/index.ts");
  });
});
