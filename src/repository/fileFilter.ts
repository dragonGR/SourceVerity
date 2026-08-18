import fs from "node:fs/promises";
import path from "node:path";
import ignore, { type Ignore } from "ignore";
import { normalizePath } from "../core/paths.js";

type IgnoreFactory = (options?: unknown) => Ignore;
const createIgnore: IgnoreFactory =
  typeof ignore === "function"
    ? (ignore as unknown as IgnoreFactory)
    : (ignore as unknown as { default: IgnoreFactory }).default;

export const DEFAULT_IGNORE_PATTERNS = [
  "node_modules",
  "node_modules/**",
  "dist",
  "dist/**",
  "build",
  "build/**",
  "coverage",
  "coverage/**",
  ".git",
  ".git/**",
  ".next",
  ".next/**",
  ".turbo",
  ".turbo/**",
  ".nuxt",
  ".nuxt/**",
  ".cache",
  ".cache/**",
  ".sourceverity-cache",
  ".sourceverity-cache/**",
  "*.log",
  ".DS_Store",
] as const;

/**
 * Creates a repository file filter that checks file paths against default ignore rules,
 * local .gitignore files, and optional custom patterns.
 *
 * Returns a predicate that returns true if the file should be INCLUDED in analysis,
 * and false if the file should be IGNORED.
 */
export async function createFileFilter(
  rootDir: string,
  customIgnores?: readonly string[] | undefined
): Promise<(filePath: string) => boolean> {
  const ig = createIgnore();

  // 1. Add default ignore patterns
  ig.add(DEFAULT_IGNORE_PATTERNS as unknown as string[]);

  // 2. Add custom ignore patterns if provided
  if (customIgnores && customIgnores.length > 0) {
    ig.add(customIgnores as string[]);
  }

  // 3. Read root .gitignore if present
  const rootGitignore = path.join(rootDir, ".gitignore");
  try {
    const content = await fs.readFile(rootGitignore, "utf-8");
    ig.add(content);
  } catch {
    // No .gitignore present, continue with defaults
  }

  const resolvedRoot = path.resolve(rootDir);

  return (filePath: string): boolean => {
    if (!filePath) return false;

    // Resolve absolute path and compute relative path from repository root
    const absoluteTarget = path.isAbsolute(filePath)
      ? path.resolve(filePath)
      : path.resolve(resolvedRoot, filePath);

    const relativeFromRoot = path.relative(resolvedRoot, absoluteTarget);

    // If path resolves outside the repository root, do not include it in repository scan
    if (
      relativeFromRoot.startsWith("..") ||
      relativeFromRoot === ".." ||
      path.isAbsolute(relativeFromRoot)
    ) {
      return false;
    }

    const normalized = normalizePath(relativeFromRoot);
    if (!normalized || normalized === ".") return false;

    // ig.ignores returns true if path matches ignore rules -> invert for inclusion
    return !ig.ignores(normalized);
  };
}
