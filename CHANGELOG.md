# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-08-18

### Added
- Repository discovery engine supporting standalone packages, npm, pnpm, Yarn, and Bun workspaces.
- Target repository TypeScript compiler resolution and Program/TypeChecker instance reuse.
- 12 semantic correctness and lifecycle audit rules:
  - `async/async-foreach`
  - `async/floating-promise`
  - `typescript/unsafe-unvalidated-assertion`
  - `typescript/non-null-assertion-risk`
  - `typescript/unchecked-index-access`
  - `network/fetch-status-unchecked`
  - `browser/event-listener-cleanup`
  - `browser/timer-cleanup`
  - `browser/observer-cleanup`
  - `react/async-effect-callback`
  - `react/derived-state-effect`
  - `react/missing-effect-cleanup`
- React-aware semantic analysis handling hook imports, aliasing, and lifecycle ownership.
- TypeScript strictness gap analyzer (`sourceverity strictness`).
- Deterministic semantic fingerprinting (`sv_<16-hex>`).
- Multi-format reporters: Pretty terminal (NO_COLOR/TTY aware), JSON, Agent format for LLMs, and SARIF 2.1.0.
- Baseline management for tracking delta findings (`sourceverity baseline`).
- Git changed-file analysis mode (`--changed`).
- Zero-dependency CLI argument parser with deterministic exit codes.
- Programmatic TypeScript API (`scanRepository`, `evaluateStrictness`, `createBaseline`, `compareWithBaseline`).
- Node.js >= 20.12.0 runtime support.

## [1.0.1] - 2026-08-19

### Changed
- Refined `browser/timer-cleanup` diagnostics to distinguish one-shot `setTimeout` lifecycle risk from repeating `setInterval` behavior.
- Removed unsupported claims about state leaks, memory leaks, and CPU consumption from timer evidence.
- Expanded timer cleanup regression coverage for mismatched cleanup functions and `useLayoutEffect`.

## [1.0.2] - 2026-08-20

### Improved
- Significantly improved semantic precision across real-world TypeScript and React codebases.
- Expanded `typescript/non-null-assertion-risk` with conservative control-flow and array-bounds reasoning, including:
  - Dominating length and bounds guards.
  - `findIndex()` result provenance and validation.
  - Bounded loop offsets such as `array[i + 1]`.
  - Static and constructed array cardinality proofs.
  - Nested array shape reasoning.
  - React state index transition analysis.
  - `Array.prototype.map` and `forEach` callback index and receiver identity.
  - Sliced-array callback bounds.
  - Mutation-aware invalidation of previously established bounds.
- Improved `async/floating-promise` analysis with stronger promise-flow, rejection propagation, local and cross-file function summaries, and calibrated severity/confidence.
- Added semantic handling for lifecycle/control objects that are thenable but are not primarily Promise operations.
- Added symbol-origin-aware models for supported framework and library APIs, including React Router, React Hook Form, TanStack Query, i18next, Node.js test APIs, and animation controllers.
- Improved `browser/timer-cleanup` with collection-aware timer ownership and cleanup detection.
- Improved runtime-boundary assertion diagnostics when exceptions are contained by local `try/catch`.
- Improved diagnostic calibration so high-confidence errors are reserved for semantically proven failure paths while uncertain async behavior is reported as advisory warnings.

### Fixed
- Fixed false positives for timers stored in collections and cleared through `forEach`, callback iteration, or equivalent cleanup patterns.
- Fixed false positives for safe non-null assertions protected by mathematically sufficient bounds checks.
- Fixed false positives for bounded search-derived indices and length-preserving array transformations.
- Fixed false positives for `Array.prototype.map`/`forEach` third callback parameter access under valid bounds guards.
- Fixed false positives for Node.js test registration APIs incorrectly interpreted as floating promises.
- Fixed false positives for verified animation lifecycle handles incorrectly interpreted as unhandled Promises.
- Fixed incorrect high-confidence classification of internally handled or semantically uncertain async calls.
- Fixed package version reporting so runtime reporters and CLI output no longer rely on independently hardcoded version strings.

### Validation
- Expanded semantic, adversarial, and false-negative regression coverage for every new proof path.
- Verified unsafe near-miss cases remain reportable when collection identity, bounds, dominance, mutation safety, or rejection handling cannot be proven.
- Validated precision against multiple real-world TypeScript/React repositories.
- Verified deterministic findings across repeated scans.
- Verified SourceVerity self-analysis completes with zero findings.
- Preserved the single-Program / single-TypeChecker analysis architecture without introducing additional runtime dependencies.

