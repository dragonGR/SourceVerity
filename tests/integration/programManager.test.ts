import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { discoverRepository } from "../../src/repository/detector.js";
import { loadRepositoryTypeScript } from "../../src/repository/tsLoader.js";
import { resolveTsProjects } from "../../src/typescript/projectResolver.js";
import { createProjectPrograms } from "../../src/typescript/programManager.js";

describe("program and typechecker manager", () => {
  const fixturesDir = path.resolve(process.cwd(), "tests/fixtures");
  const tsInst = loadRepositoryTypeScript(process.cwd());

  test("creates single Program and TypeChecker per project with non-declaration source files", async () => {
    assert.ok(tsInst !== null);
    const basicTsDir = path.join(fixturesDir, "basic-ts");
    const repo = await discoverRepository(basicTsDir);
    const projects = resolveTsProjects(repo, tsInst);
    const programs = createProjectPrograms(projects, tsInst);

    assert.equal(programs.length, 1);
    const projProg = programs[0]!;
    assert.ok(projProg.program !== undefined);
    assert.ok(projProg.checker !== undefined);
    assert.equal(projProg.sourceFiles.length, 1);
    assert.ok(projProg.sourceFiles[0]?.fileName.endsWith("src/index.ts"));

    // Verify checker can retrieve symbols from source file
    const sf = projProg.sourceFiles[0]!;
    const symbols = projProg.checker.getSymbolsInScope(sf, tsInst.ts.SymbolFlags.Function);
    assert.ok(symbols.some((s) => s.name === "add"), "Checker should resolve symbol 'add'");
  });
});
