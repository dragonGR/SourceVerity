import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SOURCEVERITY_VERSION } from "../../src/core/version.js";

describe("package.json metadata and structure", () => {
  const pkgPath = path.resolve(process.cwd(), "package.json");
  const pkgContent = fs.readFileSync(pkgPath, "utf-8");
  const pkg = JSON.parse(pkgContent);

  test("package has correct identity and engines", () => {
    assert.equal(pkg.name, "sourceverity");
    assert.equal(pkg.version, SOURCEVERITY_VERSION);
    assert.match(pkg.version, /^\d+\.\d+\.\d+/);
    assert.equal(pkg.type, "module");
    assert.equal(pkg.license, "MIT");
    assert.equal(pkg.main, "./dist/index.js");
    assert.equal(pkg.types, "./dist/index.d.ts");
    assert.ok(pkg.engines?.node, "Node engine must be specified");
    assert.equal(pkg.engines.node, ">=20.12.0");
  });

  test("package defines binary executable link", () => {
    assert.equal(pkg.bin?.sourceverity, "./bin/sourceverity.js");
    const binPath = path.resolve(process.cwd(), "bin/sourceverity.js");
    assert.ok(fs.existsSync(binPath), "bin/sourceverity.js must exist");
    const binContent = fs.readFileSync(binPath, "utf-8");
    assert.ok(binContent.startsWith("#!/usr/bin/env node"), "bin file must have shebang");
  });

  test("package defines standard exports and files field", () => {
    assert.ok(pkg.exports, "exports field must exist");
    assert.equal(pkg.exports["."]?.import, "./dist/index.js");
    assert.equal(pkg.exports["."]?.types, "./dist/index.d.ts");
    assert.ok(Array.isArray(pkg.files), "files field must be an array");
    assert.ok(pkg.files.includes("dist"), "files must include dist");
    assert.ok(pkg.files.includes("bin"), "files must include bin");
    assert.ok(pkg.files.includes("README.md"), "files must include README.md");
    assert.ok(pkg.files.includes("LICENSE"), "files must include LICENSE");
  });

  test("runtime dependencies are strictly minimal and justified", () => {
    const deps = Object.keys(pkg.dependencies || {});
    assert.deepEqual(deps, ["ignore"], "Only ignore is permitted as a runtime dependency");
  });
});
