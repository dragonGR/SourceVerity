import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { normalizePath } from "../core/paths.js";

const execFileAsync = promisify(execFile);

/**
 * Discovers modified, added, or uncommitted files in a git repository.
 * Uses safe argument arrays without shell interpolation.
 * Returns null if Git is unavailable or target directory is not a git repository.
 */
export async function getChangedFiles(rootDir: string): Promise<string[] | null> {
  const resolvedDir = path.resolve(rootDir);

  try {
    // 1. Get unstaged and staged modified files from status
    const { stdout: statusOut } = await execFileAsync("git", ["status", "--porcelain", "-uall"], {
      cwd: resolvedDir,
      timeout: 10000,
    });

    const changedSet = new Set<string>();

    for (const line of statusOut.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Status lines: " M src/index.ts", "?? src/new.ts", "A  src/add.ts"
      const filePath = trimmed.slice(2).trim().replace(/^"|"$/g, "");
      if (filePath) {
        changedSet.add(normalizePath(filePath));
      }
    }

    // 2. Get files changed against HEAD
    try {
      const { stdout: diffOut } = await execFileAsync("git", ["diff", "--name-only", "HEAD"], {
        cwd: resolvedDir,
        timeout: 10000,
      });

      for (const line of diffOut.split("\n")) {
        const filePath = line.trim().replace(/^"|"$/g, "");
        if (filePath) {
          changedSet.add(normalizePath(filePath));
        }
      }
    } catch {
      // HEAD may not exist on empty repository; proceed with status
    }

    return Array.from(changedSet);
  } catch {
    // Git not available or not a git repository
    return null;
  }
}
