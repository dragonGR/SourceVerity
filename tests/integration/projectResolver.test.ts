import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { discoverRepository } from "../../src/repository/detector.js";
import { loadRepositoryTypeScript } from "../../src/repository/tsLoader.js";
import { resolveTsProjects } from "../../src/typescript/projectResolver.js";

describe("tsconfig and project references resolver", () => {
  const fixturesDir = path.resolve(process.cwd(), "tests/fixtures");
  const tsInst = loadRepositoryTypeScript(process.cwd());

  test("resolves tsconfig in basic standalone repository", async () => {
    assert.ok(tsInst !== null);
    const basicTsDir = path.join(fixturesDir, "basic-ts");
    const repo = await discoverRepository(basicTsDir);
    const projects = resolveTsProjects(repo, tsInst);

    assert.equal(projects.length, 1);
    const proj = projects[0]!;
    assert.ok(proj.configPath.endsWith("tsconfig.json"));
    assert.equal(proj.fileNames.length, 1);
    assert.ok(proj.fileNames[0]?.endsWith("src/index.ts"));
    assert.equal(proj.rawCompilerOptions.strict, true);
  });

  test("resolves root tsconfig and referenced projects in monorepo", async () => {
    assert.ok(tsInst !== null);
    const monorepoDir = path.join(fixturesDir, "monorepo-pnpm");
    const repo = await discoverRepository(monorepoDir);
    const projects = resolveTsProjects(repo, tsInst);

    assert.equal(projects.length, 3); // root + packages/ui + apps/web
    const configNames = projects.map((p) => path.relative(monorepoDir, p.configPath)).sort();
    assert.deepEqual(configNames, ["apps/web/tsconfig.json", "packages/ui/tsconfig.json", "tsconfig.json"]);
  });
});
