import { parseArgs } from "node:util";

export type CliCommand = "scan" | "strictness" | "rules" | "explain" | "baseline" | "help" | "version";

export type OutputFormat = "pretty" | "json" | "agent" | "sarif";

export type MinConfidence = "high" | "medium" | "low";

export type FailOnSeverity = "error" | "warning" | "never";

export interface CliOptions {
  readonly command: CliCommand;
  readonly targetDir: string;
  readonly format: OutputFormat;
  readonly minConfidence: MinConfidence;
  readonly failOn: FailOnSeverity;
  readonly configPath?: string | undefined;
  readonly baselinePath?: string | undefined;
  readonly updateBaseline: boolean;
  readonly changedOnly: boolean;
  readonly verbose: boolean;
  readonly quiet: boolean;
  readonly color?: boolean | undefined;
  readonly ruleArg?: string | undefined;
  readonly baselineSubcommand?: "create" | "check" | undefined;
}

/**
 * Parses raw command-line arguments into structured CliOptions.
 * Throws an Error with a descriptive message on invalid input.
 */
export function parseCliArgs(argv: readonly string[]): CliOptions {
  const optionsConfig = {
    help: { type: "boolean" as const, short: "h" },
    version: { type: "boolean" as const, short: "v" },
    format: { type: "string" as const, short: "f" },
    "min-confidence": { type: "string" as const },
    "fail-on": { type: "string" as const },
    config: { type: "string" as const, short: "c" },
    baseline: { type: "string" as const, short: "b" },
    "update-baseline": { type: "boolean" as const, short: "u" },
    changed: { type: "boolean" as const },
    verbose: { type: "boolean" as const },
    quiet: { type: "boolean" as const, short: "q" },
    color: { type: "boolean" as const },
    "no-color": { type: "boolean" as const },
  };

  const parsed = parseArgs({
    args: [...argv],
    options: optionsConfig,
    allowPositionals: true,
    strict: true,
  });

  if (parsed.values.help) {
    return createDefaultOptions("help");
  }

  if (parsed.values.version) {
    return createDefaultOptions("version");
  }

  const positionals = parsed.positionals;
  let command: CliCommand = "scan";
  let targetDir = ".";
  let ruleArg: string | undefined;
  let baselineSubcommand: "create" | "check" | undefined;

  const first = positionals[0];
  if (first) {
    if (
      first === "scan" ||
      first === "strictness" ||
      first === "rules" ||
      first === "explain" ||
      first === "baseline" ||
      first === "help" ||
      first === "version"
    ) {
      command = first;
      if (command === "explain") {
        ruleArg = positionals[1];
        if (!ruleArg) {
          throw new Error("Missing rule identifier for 'explain' command. Usage: sourceverity explain <rule-id>");
        }
      } else if (command === "baseline") {
        const sub = positionals[1];
        if (sub === "create" || sub === "check") {
          baselineSubcommand = sub;
          targetDir = positionals[2] ?? ".";
        } else if (sub) {
          targetDir = sub;
        }
      } else {
        targetDir = positionals[1] ?? ".";
      }
    } else {
      // First positional is targetDir for default 'scan' command
      targetDir = first;
    }
  }

  // Format validation
  const rawFormat = parsed.values.format ?? "pretty";
  if (rawFormat !== "pretty" && rawFormat !== "json" && rawFormat !== "agent" && rawFormat !== "sarif") {
    throw new Error(`Invalid --format '${rawFormat}'. Valid options: pretty, json, agent, sarif`);
  }

  // Min confidence validation
  const rawConfidence = parsed.values["min-confidence"] ?? "high";
  if (rawConfidence !== "high" && rawConfidence !== "medium" && rawConfidence !== "low") {
    throw new Error(`Invalid --min-confidence '${rawConfidence}'. Valid options: high, medium, low`);
  }

  // Fail on validation
  const rawFailOn = parsed.values["fail-on"] ?? "error";
  if (rawFailOn !== "error" && rawFailOn !== "warning" && rawFailOn !== "never") {
    throw new Error(`Invalid --fail-on '${rawFailOn}'. Valid options: error, warning, never`);
  }

  let colorOption: boolean | undefined;
  if (parsed.values["no-color"]) {
    colorOption = false;
  } else if (parsed.values.color !== undefined) {
    colorOption = parsed.values.color;
  }

  return {
    command,
    targetDir,
    format: rawFormat as OutputFormat,
    minConfidence: rawConfidence as MinConfidence,
    failOn: rawFailOn as FailOnSeverity,
    configPath: parsed.values.config,
    baselinePath: parsed.values.baseline,
    updateBaseline: Boolean(parsed.values["update-baseline"]),
    changedOnly: Boolean(parsed.values.changed),
    verbose: Boolean(parsed.values.verbose),
    quiet: Boolean(parsed.values.quiet),
    color: colorOption,
    ruleArg,
    baselineSubcommand,
  };
}

function createDefaultOptions(command: CliCommand): CliOptions {
  return {
    command,
    targetDir: ".",
    format: "pretty",
    minConfidence: "high",
    failOn: "error",
    updateBaseline: false,
    changedOnly: false,
    verbose: false,
    quiet: false,
  };
}
