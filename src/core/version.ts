import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolves the authoritative SourceVerity package version by locating and reading
 * SourceVerity's package.json relative to this module's location.
 *
 * This guarantees reliable, deterministic version resolution across development,
 * compiled distribution, npm tarball, npx, npm link, and programmatic ESM imports
 * without depending on process.cwd() or searching upward from analyzed repositories.
 */
function resolvePackageVersion(): string {
  let currentDir = path.dirname(fileURLToPath(import.meta.url));

  while (true) {
    const candidatePath = path.join(currentDir, "package.json");
    try {
      if (fs.existsSync(candidatePath)) {
        const raw = fs.readFileSync(candidatePath, "utf-8");
        const parsed: unknown = JSON.parse(raw);
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "name" in parsed &&
          "version" in parsed &&
          parsed.name === "sourceverity" &&
          typeof parsed.version === "string"
        ) {
          return parsed.version;
        }
      }
    } catch {
      // Continue searching parent directories if candidate is unreadable or malformed
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  throw new Error("Unable to locate authoritative SourceVerity package.json");
}

/**
 * Authoritative runtime version of SourceVerity.
 */
export const SOURCEVERITY_VERSION: string = resolvePackageVersion();

/**
 * Returns the authoritative runtime version of SourceVerity.
 */
export function getSourceVerityVersion(): string {
  return SOURCEVERITY_VERSION;
}
