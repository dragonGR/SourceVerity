#!/usr/bin/env node

import { runCli } from "../dist/cli/main.js";

try {
  const code = await runCli(process.argv.slice(2));
  process.exitCode = code;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`sourceverity: fatal error: ${message}\n`);
  process.exitCode = 3;
}
