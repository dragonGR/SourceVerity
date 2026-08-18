/**
 * Formats help text for the SourceVerity CLI.
 */
export function getHelpText(): string {
  return `SourceVerity - Repository-aware frontend correctness and quality auditor

USAGE:
  sourceverity scan [path] [options]
  sourceverity strictness [path] [options]
  sourceverity rules
  sourceverity explain <rule-id>
  sourceverity baseline create [path]
  sourceverity baseline check [path]

COMMANDS:
  scan [path]           Audit frontend repository for correctness problems (default)
  strictness [path]     Analyze TypeScript configuration safety and migration impact
  rules                 List all available audit rules
  explain <rule-id>     Show documentation and examples for a specific rule
  baseline create       Generate or update .sourceverity-baseline.json
  baseline check        Scan repository and report only new findings against baseline
  help                  Show this help message
  version               Show SourceVerity version

OPTIONS:
  -f, --format <type>   Output format: pretty (default), json, agent, sarif
  --min-confidence <lvl> Minimum finding confidence to report: high (default), medium, low
  --fail-on <severity>  Exit with status 1 on: error (default), warning, never
  -b, --baseline <path> Path to baseline file (default: .sourceverity-baseline.json)
  -u, --update-baseline Update baseline file with current findings
  --changed             Analyze only git-changed files in the repository
  -c, --config <path>   Path to custom sourceverity.json configuration
  --color / --no-color  Force enable or disable ANSI color output
  -q, --quiet           Suppress informational messages and progress
  --verbose             Show extended diagnostic and framework metadata
  -h, --help            Show help
  -v, --version         Show version

EXIT CODES:
  0  Scan passed or findings within configured thresholds
  1  Findings violated configured failure policy (--fail-on)
  2  Configuration, arguments, or repository input error
  3  Internal analysis or execution error
`;
}
