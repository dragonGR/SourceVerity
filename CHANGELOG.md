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

