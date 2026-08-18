# Contributing to SourceVerity

Thank you for contributing to SourceVerity.

## Prerequisites

- Node.js >= 20.12.0
- npm >= 10.0.0

## Getting Started

1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```

2. Build the project:
   ```bash
   npm run build
   ```

3. Run the full test suite:
   ```bash
   npm test
   ```

4. Run strict type checking:
   ```bash
   npm run typecheck
   ```

5. Run the complete local verification gate:
   ```bash
   npm run verify
   ```

## Development Principles

- **Zero Unjustified Dependencies**: Use Node.js built-in modules where practical.
- **Strict Semantic Accuracy**: Every semantic rule must account for shadowing, aliasing, and type boundaries.
- **True-Negative Coverage**: Every rule must have rigorous tests asserting that safe, standard patterns are not flagged.
- **Deterministic Output**: Output and fingerprints must be stable and reproducible.
