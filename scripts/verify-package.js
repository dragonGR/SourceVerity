import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function verifyPackage() {
  console.log("Running SourceVerity Package Verification & Clean Consumer Smoke Test...\n");
  const rootDir = process.cwd();

  // 1. Pack tarball
  console.log("1. Running npm pack...");
  const { stdout: packStdout } = await execFileAsync("npm", ["pack", "--json"], { cwd: rootDir });
  const packInfo = JSON.parse(packStdout);
  const tarballName = packInfo[0].filename;
  const tarballPath = path.join(rootDir, tarballName);
  const packedFiles = packInfo[0].files.map((f) => f.path);

  console.log(`   Packed tarball: ${tarballName} (${packedFiles.length} files)`);

  // 2. Validate packed file contents
  console.log("2. Validating tarball contents...");
  const forbiddenSubstrings = ["tests/", "fixtures/", "scripts/", ".github/", ".editorconfig", "tsconfig."];
  for (const file of packedFiles) {
    for (const forbidden of forbiddenSubstrings) {
      if (file.includes(forbidden)) {
        throw new Error(`Tarball contains forbidden file: ${file}`);
      }
    }
  }

  const requiredEntries = ["dist/index.js", "dist/index.d.ts", "bin/sourceverity.js", "package.json", "README.md", "LICENSE"];
  for (const req of requiredEntries) {
    if (!packedFiles.includes(req)) {
      throw new Error(`Tarball missing required entry: ${req}`);
    }
  }
  console.log("   Tarball contains only clean distribution artifacts.");

  // 3. Create clean temporary consumer
  console.log("3. Installing tarball into clean isolated consumer...");
  const consumerDir = await fs.mkdtemp(path.join(os.tmpdir(), "sv-consumer-"));

  try {
    await fs.writeFile(
      path.join(consumerDir, "package.json"),
      JSON.stringify(
        {
          name: "test-consumer",
          version: "1.0.0",
          type: "module",
        },
        null,
        2
      )
    );

    // Create a small sample TypeScript file to audit in consumer
    await fs.mkdir(path.join(consumerDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(consumerDir, "src", "index.ts"),
      "export function greet(name: string): string { return 'Hello ' + name; }\n"
    );
    await fs.writeFile(
      path.join(consumerDir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", strict: true }, include: ["src/**/*"] }, null, 2)
    );

    // Install tarball
    await execFileAsync("npm", ["install", tarballPath], { cwd: consumerDir });

    // 4. Verify CLI execution from installed package
    console.log("4. Verifying CLI execution in consumer...");
    const { stdout: verStdout } = await execFileAsync("npx", ["sourceverity", "--version"], { cwd: consumerDir });
    if (!verStdout.includes("1.0.0")) {
      throw new Error(`CLI --version failed in consumer. Output: ${verStdout}`);
    }

    const { stdout: scanStdout } = await execFileAsync("npx", ["sourceverity", "scan", ".", "--format", "json"], { cwd: consumerDir });
    const parsedScan = JSON.parse(scanStdout);
    if (!Array.isArray(parsedScan.findings)) {
      throw new Error("CLI scan in consumer did not return valid findings array");
    }
    console.log("   CLI executed cleanly from installed package.");

    // 5. Verify Programmatic ESM import
    console.log("5. Verifying programmatic API import in consumer...");
    const consumerScript = `
import { scanRepository } from "sourceverity";

async function run() {
  const result = await scanRepository({ targetDir: process.cwd() });
  if (!result || !Array.isArray(result.findings)) {
    throw new Error("scanRepository returned invalid result structure");
  }
  console.log("PROGRAMMATIC_API_OK");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
    `.trim();

    await fs.writeFile(path.join(consumerDir, "run-test.js"), consumerScript);
    const { stdout: nodeStdout } = await execFileAsync("node", ["run-test.js"], { cwd: consumerDir });
    if (!nodeStdout.includes("PROGRAMMATIC_API_OK")) {
      throw new Error(`Programmatic import failed in consumer. Output: ${nodeStdout}`);
    }
    console.log("   Programmatic import and scanRepository verified.");
  } finally {
    await fs.rm(consumerDir, { recursive: true, force: true });
    await fs.rm(tarballPath, { force: true });
  }

  console.log("\nPackage verification passed with 100% success.");
}

verifyPackage().catch((err) => {
  console.error("\nPackage verification FAILED:", err);
  process.exit(1);
});
