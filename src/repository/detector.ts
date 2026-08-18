import fs from "node:fs/promises";
import path from "node:path";
import { normalizePath } from "../core/paths.js";
import type {
  PackageManagerType,
  PackageManifest,
  DiscoveredPackage,
  FrameworkInfo,
  RepositoryContext,
} from "./types.js";

/**
 * Safely parses a JSON file, returning undefined if missing or malformed.
 */
async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    // sourceverity-disable-next-line typescript/unsafe-unvalidated-assertion -- generic raw JSON parser helper
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/**
 * Checks if a file or directory exists.
 */
async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detects the package manager used in the repository root.
 */
async function detectPackageManager(rootDir: string): Promise<PackageManagerType> {
  if (await pathExists(path.join(rootDir, "pnpm-lock.yaml"))) return "pnpm";
  if (await pathExists(path.join(rootDir, "package-lock.json"))) return "npm";
  if (await pathExists(path.join(rootDir, "yarn.lock"))) return "yarn";
  if ((await pathExists(path.join(rootDir, "bun.lockb"))) || (await pathExists(path.join(rootDir, "bun.lock")))) return "bun";
  return "unknown";
}

/**
 * Parses pnpm-workspace.yaml package patterns without external YAML libraries.
 */
async function parsePnpmWorkspaceYaml(pnpmYamlPath: string): Promise<string[]> {
  try {
    const content = await fs.readFile(pnpmYamlPath, "utf-8");
    const patterns: string[] = [];
    let inPackagesBlock = false;

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("packages:")) {
        inPackagesBlock = true;
        continue;
      }
      if (inPackagesBlock) {
        if (trimmed.startsWith("-")) {
          const raw = trimmed.replace(/^-\s*/, "").replace(/['"]/g, "").trim();
          if (raw) patterns.push(raw);
        } else if (trimmed.length > 0 && !trimmed.startsWith("#")) {
          inPackagesBlock = false;
        }
      }
    }
    return patterns;
  } catch {
    return [];
  }
}

/**
 * Expands workspace directory globs (e.g. "apps/*", "packages/*").
 */
async function expandWorkspacePatterns(rootDir: string, patterns: readonly string[]): Promise<string[]> {
  const result: string[] = [];

  for (const pattern of patterns) {
    const normalized = pattern.replace(/\\/g, "/");
    if (normalized.endsWith("/*")) {
      const parentDir = path.join(rootDir, normalized.slice(0, -2));
      try {
        const entries = await fs.readdir(parentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith(".")) {
            const pkgDir = path.join(parentDir, entry.name);
            if (await pathExists(path.join(pkgDir, "package.json"))) {
              result.push(pkgDir);
            }
          }
        }
      } catch {
        // Parent dir does not exist; continue
      }
    } else {
      const directDir = path.join(rootDir, normalized);
      if (await pathExists(path.join(directDir, "package.json"))) {
        result.push(directDir);
      }
    }
  }

  return result;
}

/**
 * Extracts framework and tool dependencies across all discovered packages.
 */
function extractFrameworks(manifests: readonly PackageManifest[]): {
  reactVersion: string | undefined;
  reactDomVersion: string | undefined;
  hasReactCompiler: boolean;
  frameworks: FrameworkInfo[];
} {
  let reactVersion: string | undefined;
  let reactDomVersion: string | undefined;
  let hasReactCompiler = false;
  const frameworksMap = new Map<string, string | undefined>();

  const KNOWN_FRAMEWORKS = [
    { key: "next", name: "Next.js" },
    { key: "vite", name: "Vite" },
    { key: "@remix-run/react", name: "Remix" },
    { key: "react-router", name: "React Router" },
    { key: "astro", name: "Astro" },
    { key: "gatsby", name: "Gatsby" },
  ];

  for (const manifest of manifests) {
    const allDeps = {
      ...manifest.peerDependencies,
      ...manifest.devDependencies,
      ...manifest.dependencies,
    };

    if (!reactVersion && allDeps["react"]) {
      reactVersion = allDeps["react"];
    }
    if (!reactDomVersion && allDeps["react-dom"]) {
      reactDomVersion = allDeps["react-dom"];
    }
    if (allDeps["babel-plugin-react-compiler"] || allDeps["eslint-plugin-react-compiler"]) {
      hasReactCompiler = true;
    }

    for (const fw of KNOWN_FRAMEWORKS) {
      const version = allDeps[fw.key];
      if (version && !frameworksMap.has(fw.name)) {
        frameworksMap.set(fw.name, version);
      }
    }
  }

  const frameworks: FrameworkInfo[] = Array.from(frameworksMap.entries()).map(([name, version]) => ({
    name,
    version,
  }));

  return { reactVersion, reactDomVersion, hasReactCompiler, frameworks };
}

/**
 * Audits repository directory and discovers packages, workspaces, package manager, and framework configuration.
 */
export async function discoverRepository(rootDir: string): Promise<RepositoryContext> {
  const resolvedRoot = path.resolve(rootDir);
  const packageManager = await detectPackageManager(resolvedRoot);
  const rootManifestPath = path.join(resolvedRoot, "package.json");
  const rootManifest = await readJsonFile<PackageManifest>(rootManifestPath);

  const packages: DiscoveredPackage[] = [];
  let isMonorepo = false;
  let workspaceType: "pnpm" | "npm" | "yarn" | "bun" | undefined;

  // 1. Check pnpm-workspace.yaml
  const pnpmWorkspacePath = path.join(resolvedRoot, "pnpm-workspace.yaml");
  if (await pathExists(pnpmWorkspacePath)) {
    isMonorepo = true;
    workspaceType = "pnpm";
    const patterns = await parsePnpmWorkspaceYaml(pnpmWorkspacePath);
    const dirs = await expandWorkspacePatterns(resolvedRoot, patterns);
    for (const pkgDir of dirs) {
      const pkgManifest = await readJsonFile<PackageManifest>(path.join(pkgDir, "package.json"));
      if (pkgManifest) {
        packages.push({
          name: pkgManifest.name ?? path.basename(pkgDir),
          packageDir: pkgDir,
          relativePath: normalizePath(pkgDir, resolvedRoot),
          packageJson: pkgManifest,
          isRoot: false,
        });
      }
    }
  } else if (rootManifest?.workspaces) {
    // 2. Check package.json workspaces
    isMonorepo = true;
    workspaceType = packageManager === "unknown" ? "npm" : (packageManager as "npm" | "yarn" | "bun");
    const rawWorkspaces = rootManifest.workspaces;
    const rawPatterns: readonly string[] = Array.isArray(rawWorkspaces)
      ? rawWorkspaces
      : typeof rawWorkspaces === "object" && rawWorkspaces && "packages" in rawWorkspaces && Array.isArray(rawWorkspaces.packages)
      ? rawWorkspaces.packages
      : [];
    const dirs = await expandWorkspacePatterns(resolvedRoot, rawPatterns);
    for (const pkgDir of dirs) {
      const pkgManifest = await readJsonFile<PackageManifest>(path.join(pkgDir, "package.json"));
      if (pkgManifest) {
        packages.push({
          name: pkgManifest.name ?? path.basename(pkgDir),
          packageDir: pkgDir,
          relativePath: normalizePath(pkgDir, resolvedRoot),
          packageJson: pkgManifest,
          isRoot: false,
        });
      }
    }
  }

  // Add root package if package.json exists
  if (rootManifest) {
    packages.unshift({
      name: rootManifest.name ?? "root",
      packageDir: resolvedRoot,
      relativePath: ".",
      packageJson: rootManifest,
      isRoot: true,
    });
  }

  const allManifests = packages.map((p) => p.packageJson);
  const frameworkData = extractFrameworks(allManifests);

  return {
    rootDir: resolvedRoot,
    packageManager,
    isMonorepo,
    workspaceType,
    rootManifest,
    packages,
    reactVersion: frameworkData.reactVersion,
    reactDomVersion: frameworkData.reactDomVersion,
    hasReactCompiler: frameworkData.hasReactCompiler,
    frameworks: frameworkData.frameworks,
  };
}
