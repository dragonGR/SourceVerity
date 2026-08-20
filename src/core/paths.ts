import path from "node:path";

/**
 * Normalizes any file system path into a standardized POSIX relative path.
 * Ensures consistent output across Windows and POSIX systems.
 */
export function normalizePath(filePath: string, relativeTo?: string): string {
  if (!filePath) {
    return "";
  }

  let resolved = filePath;
  if (relativeTo && path.isAbsolute(filePath)) {
    resolved = path.relative(relativeTo, filePath);
  }

  // Convert Windows backslashes to POSIX forward slashes
  let normalized = resolved.replace(/\\/g, "/");

  // Remove leading './' if present
  if (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }

  // Normalize duplicate slashes
  normalized = normalized.replace(/\/{2,}/g, "/");

  return normalized;
}
