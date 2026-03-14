# @affectively/aeon-logic

`@affectively/aeon-logic` is a formal-methods toolkit for fork/race/fold-style systems. It combines a model checker, TLA and TLC helpers, a browser-safe TLA sandbox path, Lean project inspection, `.gg` parsing, and boundary-learning utilities in one package.

The fair brag is that this is more than a checker by itself. The repo already covers a full working path from parsing artifacts to running checks to rendering traces and generated files.

## What It Provides

- a finite-state model checker with invariant and eventual-property checks
- weak-fairness filtering for liveness counterexamples
- TLC config parsing and serialization
- TLA module parsing and rendering
- a TLA sandbox runner for WASM-friendly environments
- a browser-safe entrypoint that avoids Node-only Lean helpers
- Lean project inspection and optional sandboxed build support
- checker trace adapters for TLC-like text and JSON
- native `.gg` parsing and `.gg`-to-model conversion
- boundary-learning helpers for inversion pairs and sweep reports

## Why People May Like It

- the parsing, checking, and artifact-generation pieces are already in one place,
- there is a browser-friendly path when you only need the TLA side,
- `.gg` is treated as a first-class input instead of requiring a separate conversion step outside the package,
- and the trace and artifact helpers make the output easier to inspect and reuse.

## Install

```bash
bun install
```

## Quick Example

```ts
import {
  ForkRaceFoldModelChecker,
  parseTlcConfig,
  renderTlaModule,
  runTlaSandbox,
  checkGgProgram,
} from '@affectively/aeon-logic';

const checker = new ForkRaceFoldModelChecker<{ value: number }>();

const result = await checker.check(
  {
    initialStates: [{ value: 0 }],
    fingerprint: (state) => `${state.value}`,
    actions: [
      {
        name: 'Inc',
        enabled: (state) => state.value < 2,
        successors: (state) => [{ value: state.value + 1 }],
      },
    ],
  },
  {
    invariants: [{ name: 'Bounded', test: (state) => state.value <= 2 }],
    eventual: [{ name: 'Reached2', test: (state) => state.value === 2 }],
  }
);

const cfg = parseTlcConfig(`SPECIFICATION Spec`);
const tlaText = renderTlaModule({
  moduleName: 'Spec',
  extends: ['Naturals'],
  body: ['Spec == TRUE'],
});

const tlaSandboxReport = runTlaSandbox(`${tlaText}`);
const ggResult = await checkGgProgram(`
  (input)-[:FORK]->(a | b)-[:RACE]->(winner)
`);
```

## Run

```bash
bun run check
bun run build
```

## Repo Guide

- [src/README.md](./src/README.md): source module map
- [test/README.md](./test/README.md): test coverage map

## Why This README Is Grounded

Aeon Logic does not need to pretend it is simple. The strongest fair brag is that it already gives you a serious formal tooling package with checker, parser, sandbox, and `.gg` support in one place.
