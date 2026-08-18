import { test, describe } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { createFileFilter } from "../../src/repository/fileFilter.js";

describe("file filter and gitignore engine", () => {
  test("filters default ignore patterns", async () => {
    const filter = await createFileFilter(process.cwd());

    assert.equal(filter("src/index.ts"), true);
    assert.equal(filter("apps/web/src/App.tsx"), true);
    assert.equal(filter("node_modules/pkg/index.js"), false);
    assert.equal(filter("dist/index.js"), false);
    assert.equal(filter(".git/HEAD"), false);
    assert.equal(filter(".next/server/pages.js"), false);
  });

  test("respects custom ignore patterns", async () => {
    const filter = await createFileFilter(process.cwd(), ["generated/**", "*.tmp.ts"]);

    assert.equal(filter("src/index.ts"), true);
    assert.equal(filter("generated/schema.ts"), false);
    assert.equal(filter("src/scratch.tmp.ts"), false);
  });

  test("loads .gitignore file from directory and supports negation", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sv-filter-"));
    try {
      await fs.writeFile(path.join(tmpDir, ".gitignore"), "custom_build/*\n!custom_build/important.ts\n");
      const filter = await createFileFilter(tmpDir);

      assert.equal(filter(path.join(tmpDir, "src/main.ts")), true);
      assert.equal(filter(path.join(tmpDir, "custom_build/output.js")), false);
      assert.equal(filter(path.join(tmpDir, "custom_build/important.ts")), true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("safely handles out-of-tree and external paths without RangeError", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sv-filter-out-"));
    try {
      const filter = await createFileFilter(tmpDir);

      // Should return false cleanly for out-of-tree paths without throwing RangeError
      assert.doesNotThrow(() => {
        assert.equal(filter("/tmp/outside-repo.ts"), false);
        assert.equal(filter("../outside.ts"), false);
        assert.equal(filter("../../parent/sibling.ts"), false);
        assert.equal(filter("..\\outside.ts"), false);
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
