import { createRequire } from "node:module";
import path from "node:path";
import type * as tsType from "typescript";

export interface TypeScriptInstance {
  readonly ts: typeof tsType;
  readonly version: string;
  readonly isLocal: boolean;
  readonly packagePath: string;
}

/**
 * Dynamically resolves and loads the target repository's installed TypeScript compiler.
 *
 * Uses Node's module resolution originating at projectRoot.
 * Returns null if TypeScript is not installed in the target repository.
 */
export function loadRepositoryTypeScript(projectRoot: string): TypeScriptInstance | null {
  try {
    const fakePackageJson = path.join(path.resolve(projectRoot), "package.json");
    const req = createRequire(fakePackageJson);
    const tsPath = req.resolve("typescript");
    const ts = req("typescript") as typeof tsType;
    const version = ts.version ?? "unknown";

    return {
      ts,
      version,
      isLocal: true,
      packagePath: tsPath,
    };
  } catch {
    return null;
  }
}
