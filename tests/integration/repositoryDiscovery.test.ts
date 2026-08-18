import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { discoverRepository } from "../../src/repository/detector.js";

describe("repository and workspace discovery", () => {
  const fixturesDir = path.resolve(process.cwd(), "tests/fixtures");

  test("discovers standalone npm repository", async () => {
    const basicTsDir = path.join(fixturesDir, "basic-ts");
    const repo = await discoverRepository(basicTsDir);

    assert.equal(repo.packageManager, "npm");
    assert.equal(repo.isMonorepo, false);
    assert.equal(repo.packages.length, 1);
    assert.equal(repo.packages[0]?.name, "fixture-basic-ts");
  });

  test("discovers pnpm monorepo and workspace packages", async () => {
    const monorepoDir = path.join(fixturesDir, "monorepo-pnpm");
    const repo = await discoverRepository(monorepoDir);

    assert.equal(repo.packageManager, "pnpm");
    assert.equal(repo.isMonorepo, true);
    assert.equal(repo.workspaceType, "pnpm");
    assert.equal(repo.packages.length, 3); // root + apps/web + packages/ui

    const packageNames = repo.packages.map((p) => p.name).sort();
    assert.deepEqual(packageNames, ["@monorepo/ui", "@monorepo/web", "fixture-monorepo-pnpm"]);

    assert.equal(repo.reactVersion, "19.0.0");
    assert.equal(repo.reactDomVersion, "19.0.0");
    const fwNames = repo.frameworks.map((f) => f.name);
    assert.ok(fwNames.includes("Next.js"));
  });

  test("discovers React version and React Compiler in standalone app", async () => {
    const reactAppDir = path.join(fixturesDir, "react-app");
    const repo = await discoverRepository(reactAppDir);

    assert.equal(repo.reactVersion, "18.3.1");
    assert.equal(repo.hasReactCompiler, true);
    const fwNames = repo.frameworks.map((f) => f.name);
    assert.ok(fwNames.includes("Vite"));
  });
});
