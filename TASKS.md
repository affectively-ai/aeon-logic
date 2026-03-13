# aeon-logic Boundary/Inversion Worklist

## Scope Lock
- [x] Work only in `open-source/aeon-logic`.
- [x] No cross-repo drift until all tasks below are complete.

## Core Implementation
- [x] Add inversion-spec generator (claim + opposite-case pair).
  - Acceptance: returns deterministic paired specs with stable IDs.
- [x] Add boundary sweep runner over chain depth and constraint pressure.
  - Acceptance: returns flip frontiers and minimal counterexample traces.
- [x] Add truth-pressure paired checks.
  - Acceptance: strict-truth vs permissive variant on same inputs; returns separation delta.
- [x] Add unified boundary-learning report composer.
  - Acceptance: report includes tighten-vs-waste, break-vs-repair, truth separation, next probes.

## Public Surface
- [x] Export all new APIs/types from `src/index.ts`.
- [x] Document one-shot usage in `README.md`.

## Verification
- [x] Add tests for inversion generation.
- [x] Add tests for boundary frontier detection.
- [x] Add tests for truth-pressure separation delta.
- [x] Add tests for report schema and stability.
- [x] Run targeted tests for new test files.
- [x] Run full aeon-logic test suite.

## Done Definition
- [x] All aeon-logic tests pass.
- [x] New APIs are exported and documented.
- [x] Report output is reproducible and includes actionable next probes.
