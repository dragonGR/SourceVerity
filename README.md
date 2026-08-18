# SourceVerity

SourceVerity is a repository-aware frontend correctness and quality auditor for JavaScript, TypeScript, and React applications.

It identifies high-value correctness defects, resource leaks, async hazards, and hidden type-safety gaps that standard compilation, weak TypeScript configurations, or style linters do not reject.

```bash
npx sourceverity scan .
```

---

## Philosophy & Scope

SourceVerity operates on the principle: **Respect the repository. Audit beyond the repository.**

Many production codebases maintain loose TypeScript compiler options (such as `strictNullChecks: false` or `noUncheckedIndexedAccess: false`) for historical migration reasons. SourceVerity understands what your compiler accepts while independently determining whether runtime operations are genuinely safe.

### What SourceVerity Detects
- **Async Hazards**: Unawaited callbacks in array iterations, floating/unhandled Promises, missing error rejection handling.
- **Hidden Type-Safety Gaps**: Unvalidated runtime data (`JSON.parse()`, `response.json()`) asserted directly to domain types, risky non-null assertions on nullable types, unsafe unchecked index accesses.
- **Browser Resource Leaks**: Missing or mismatched `addEventListener` cleanup in lifecycle scopes, uncleaned intervals (`setInterval`), un-disconnected DOM Observers (`ResizeObserver`, `MutationObserver`).
- **Network Misuse**: Unchecked HTTP response status prior to consuming response bodies.
- **React Lifecycle Deficiencies**: Direct async callbacks passed to `useEffect`, derived local state unnecessarily synchronized inside effects, uncleaned resource subscriptions.
- **TypeScript Strictness Migration Gaps**: Measurable evaluation of potential compiler diagnostics if strict compiler flags were enabled.

### What SourceVerity Is Not
- Not a code formatter or style enforcer (not an alternative to Prettier or Biome formatting).
- Not a subjective opinion generator or naming linter.
- Not an LLM wrapper or AI reviewer (all diagnostics are computed deterministically via static AST and TypeScript semantic analysis).

---

## Installation & CLI Usage

Run SourceVerity directly using `npx`:

```bash
# Audit the current repository
npx sourceverity scan .

# Run with custom failure threshold (error, warning, never)
npx sourceverity scan . --fail-on warning

# Report only high-confidence findings
npx sourceverity scan . --min-confidence high

# Analyze only git-changed files
npx sourceverity scan . --changed
```

### Output Formats

```bash
# Default human-readable terminal format
npx sourceverity scan . --format pretty

# Deterministic JSON format
npx sourceverity scan . --format json

# Machine format tailored for LLMs and coding agents (e.g. Codex)
npx sourceverity scan . --format agent

# Standard SARIF 2.1.0 format for GitHub Code Scanning
npx sourceverity scan . --format sarif
```

---

## Using SourceVerity with Coding Agents

SourceVerity's `agent` format provides structured, deterministic diagnostics optimized for coding assistants like Codex.

Example prompt for a coding agent:

```text
Run `npx sourceverity scan . --format agent`.
Review high-confidence correctness findings.
Fix verified correctness issues without modifying unrelated formatting or architecture.
Run the project's test suite to verify no regressions.
Run SourceVerity again to verify resolution.
```

---

## TypeScript Strictness Gap Analysis

Inspect the safety gaps in your existing `tsconfig.json` and measure migration impact:

```bash
npx sourceverity strictness .
```

Example output:

```text
TypeScript Strictness Gap Analysis

Current Configuration:
  strict                         false
  strictNullChecks               false
  noUncheckedIndexedAccess       false
  exactOptionalPropertyTypes     false

Migration Impact (New Compiler Diagnostics):
  strictNullChecks                42 diagnostics
  noUncheckedIndexedAccess        18 diagnostics
  exactOptionalPropertyTypes       4 diagnostics

Top Affected Files:
  src/api/client.ts               12
  src/state/user.ts                8
```

---

## Baseline Management

When adopting SourceVerity on an existing codebase with existing findings, generate a baseline to track new regressions without blocking current work:

```bash
# Create or update baseline
npx sourceverity baseline create

# Run scan checking only new findings against baseline
npx sourceverity scan . --baseline
```

---

## Suppressions

To suppress an intentional exception, use a line-level suppression comment with a required or strongly recommended explanation:

```ts
// sourceverity-disable-next-line typescript/unsafe-unvalidated-assertion -- verified by upstream API gateway schema
const user = JSON.parse(payload) as User;
```

---

## Initial Production Rule Set

| Rule ID | Category | Default Severity | Confidence | Description |
| ------- | -------- | ---------------- | ---------- | ----------- |
| `async/async-foreach` | Async | Error | High | Asynchronous callback passed to `Array.prototype.forEach`. |
| `async/floating-promise` | Async | Error | High | Unhandled Promise returned in statement position without handling or void operator. |
| `typescript/unsafe-unvalidated-assertion` | TypeScript | Error | High | Unvalidated runtime data (`JSON.parse`, `response.json()`) asserted directly to a type. |
| `typescript/non-null-assertion-risk` | TypeScript | Warning | High | Non-null assertion (`!`) on value whose semantic type contains null or undefined. |
| `typescript/unchecked-index-access` | TypeScript | Warning | Medium | Dynamic property or index access dereferenced without presence check in loose config. |
| `network/fetch-status-unchecked` | Network | Warning | High | Consuming `fetch()` response body without checking `response.ok` or `response.status`. |
| `browser/event-listener-cleanup` | Browser | Error | High | `addEventListener` registered in lifecycle scope without matching `removeEventListener`. |
| `browser/timer-cleanup` | Browser | Error | High | `setInterval` registered in lifecycle scope without corresponding `clearInterval`. |
| `browser/observer-cleanup` | Browser | Error | High | DOM Observer (`ResizeObserver`, etc.) created in lifecycle scope without `.disconnect()`. |
| `react/async-effect-callback` | React | Error | High | Async function passed directly as `useEffect` callback argument. |
| `react/derived-state-effect` | React | Warning | High | `useEffect` used exclusively to derive local state from render inputs. |
| `react/missing-effect-cleanup` | React | Warning | High | Subscriptions or event targets instantiated in `useEffect` without returned cleanup. |

---

## Programmatic API

SourceVerity exposes a TypeScript programmatic API for build tool and custom CI integrations:

```ts
import { scanRepository } from "sourceverity";

const result = await scanRepository({
  targetDir: process.cwd(),
  minConfidence: "high",
});

console.log(`Found ${result.findings.length} findings across ${result.summary.filesAnalyzed} files.`);
```

---

## Requirements & Engines

- Node.js >= 20.12.0
- Supports npm, pnpm, Yarn, and Bun workspaces
- Analyzes TypeScript (using project's local TypeScript installation) and JavaScript

---

## License

MIT © 2026 SourceVerity Contributors
