import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

async function findTestFiles(dir) {
  try {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      dirents.map((dirent) => {
        const res = path.join(dir, dirent.name);
        return dirent.isDirectory() ? findTestFiles(res) : res;
      })
    );
    return files.flat().filter((f) => f.endsWith(".test.js"));
  } catch (err) {
    if (err.code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

async function main() {
  const testsDir = path.resolve(process.cwd(), "dist-tests/tests");
  const testFiles = await findTestFiles(testsDir);

  if (testFiles.length === 0) {
    console.error("No compiled test files found in dist-tests/tests. Run 'npm run build:tests' first.");
    process.exit(1);
  }

  // Sort files deterministically
  testFiles.sort();

  const child = spawn(process.execPath, ["--test", ...testFiles], {
    stdio: "inherit",
    cwd: process.cwd(),
  });

  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });
}

main().catch((err) => {
  console.error("Failed to run tests:", err);
  process.exit(1);
});
