import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { runAudit } from "../dist/engine/runner.js";

async function generateBenchmarkFixture(targetDir, fileCount) {
  await fs.mkdir(path.join(targetDir, "src"), { recursive: true });
  await fs.mkdir(path.join(targetDir, "node_modules"), { recursive: true });

  // Link local TypeScript installation so the repository loader resolves the authentic compiler
  const localTs = path.resolve("./node_modules/typescript");
  try {
    await fs.symlink(localTs, path.join(targetDir, "node_modules", "typescript"), "dir");
  } catch {
    // Fallback if symlink is unsupported
  }

  await fs.writeFile(
    path.join(targetDir, "package.json"),
    JSON.stringify({ name: "benchmark-fixture", version: "1.0.0" }, null, 2)
  );

  await fs.writeFile(
    path.join(targetDir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: { target: "ES2022", module: "NodeNext", strict: true },
        include: ["src/**/*"],
      },
      null,
      2
    )
  );

  for (let i = 0; i < fileCount; i++) {
    const content = `
export interface Item${i} {
  id: string;
  count: number;
}

export function compute${i}(item: Item${i}): number {
  return item.count * 2;
}

export async function loadItem${i}(id: string): Promise<Item${i}> {
  return { id, count: 42 };
}
    `.trim();
    await fs.writeFile(path.join(targetDir, "src", `file_${i}.ts`), content);
  }
}

async function runBenchmark() {
  console.log("SourceVerity Semantic Audit Benchmark Suite");
  console.log("--------------------------------------------");
  console.log(`Node.js:     ${process.version}`);
  console.log(`Platform:    ${process.platform} (${process.arch})`);
  console.log("Methodology: Real repository audit including TS resolution, Program construction,");
  console.log("             TypeChecker initialization, AST traversal, and 12-rule analysis.\n");

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sv-bench-"));

  try {
    for (const count of [50, 200]) {
      const projDir = path.join(tmpDir, `proj_${count}`);
      await generateBenchmarkFixture(projDir, count);

      const memStart = process.memoryUsage().rss;
      const tStart = performance.now();

      const result = await runAudit({ targetDir: projDir });

      const tDuration = (performance.now() - tStart).toFixed(2);
      const memEnd = process.memoryUsage().rss;
      const peakMb = ((memEnd - memStart) / 1024 / 1024).toFixed(2);
      const filesPerSec = (count / (Number(tDuration) / 1000)).toFixed(1);

      console.log(
        `  [${String(count).padStart(3)} files] Duration: ${tDuration.padStart(7)} ms | Throughput: ${filesPerSec.padStart(7)} files/sec | RSS Delta: ${peakMb.padStart(6)} MB | Analyzed: ${result.summary.filesAnalyzed} | TS: ${result.repository.typescriptVersion ?? "none"}`
      );
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  console.log("\nBenchmark complete.");
}

runBenchmark().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
