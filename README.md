# aeon-logic

Fork/race/fold temporal logic engine with TLC/TLA compatibility helpers.

## What it provides

- A finite-state model checker with:
  - invariant checking
  - eventual (`<>`) property checking
  - weak fairness filtering (`WF`) for liveness counterexamples
  - wavefront topology diagnostics (`beta1`, `frontierFill`, `wallaceNumber`, `wally`)
- TLC config (`.cfg`) parsing and serialization
  - supports nested/multiline `CONSTANTS` assignments (sets, tuples, maps)
- TLA module (`.tla`) parsing and rendering
- WASM-friendly TLA sandbox runner (`runTlaSandbox`) with module/config partitioning
- Node-friendly Lean project inspection and optional Lake build sandbox (`runLeanSandbox`)
- Checker trace adapters to TLC-like text and JSON representations
- Native `.gg` support:
  - `.gg` parsing into typed graph topology (`parseGgProgram`)
  - root/terminal node discovery helpers
  - direct `.gg` → `TemporalModel` conversion (`buildGgTemporalModel`)
  - one-shot formal verification wrapper (`checkGgProgram`)
- Logic-chain superposition primitives:
  - superposition/fork expansion
  - branch interference (constructive/destructive)
  - measurement policies (argmax, quorum, merge)
- Temporal formula DSL with superposition operators:
  - `always`, `eventually`
  - `eventually@q` and `until@q` quorum operators
- Advanced composition helpers:
  - complex-amplitude superposition chains
- Inversion-first boundary learning helpers:
  - claim/opposite inversion pair generation (`createInversionPair`)
  - boundary sweep runner with frontier detection (`runBoundarySweep`)
  - one-shot boundary learning suite report (`runBoundaryLearningSuite`)
- checker topology event bridge for `TopologySampler` sinks
  - checker wavefront metrics for warm-up / fill-drain analysis
  - chain-to-stream bridge for Aeon Flow fork/race/fold transports
  - generated superposition-focused `.tla/.cfg` artifact pairs

## Install

```bash
bun install
```

## Run

```bash
bun run check
bun run build
```

## Quick example

```ts
import {
  ForkRaceFoldModelChecker,
  LogicChainSuperposition,
  createInversionPair,
  runBoundaryLearningSuite,
  runLeanSandbox,
  checkGgProgram,
  parseTlcConfig,
  runTlaSandbox,
  renderTlaModule,
  serializeTlcConfig,
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
  },
);

const cfg = parseTlcConfig(`SPECIFICATION Spec`);
const cfgText = serializeTlcConfig(cfg);
const tlaText = renderTlaModule({
  moduleName: 'Spec',
  extends: ['Naturals'],
  body: ['Spec == TRUE'],
});

const superposed = LogicChainSuperposition.seed({ score: 0 })
  .fork(() => [
    { state: { score: 1 }, step: 'A', relativeAmplitude: 2 },
    { state: { score: -1 }, step: 'B', relativeAmplitude: 1 },
  ])
  .interfere();

const winner = superposed.measureArgmax();

const tlaSandboxReport = runTlaSandbox(`${tlaText}\n${cfgText}`);
const leanSandboxReport = runLeanSandbox({
  path: './formal/lean',
  build: false,
});
const ggResult = await checkGgProgram(`
  (input)-[:FORK]->(a | b)-[:RACE]->(winner)
`);

const boundaryReport = await runBoundaryLearningSuite({
  model: {
    initialStates: [{ value: 0 }],
    fingerprint: (state) => `${state.value}`,
    actions: [
      {
        name: 'Inc',
        enabled: (state) => state.value < 3,
        successors: (state) => [{ value: state.value + 1 }],
      },
    ],
  },
  depth: { min: 1, max: 3, step: 1 },
  pressure: { min: 0, max: 1, step: 1 },
  suite: {
    tightenVsWaste: createInversionPair({
      name: 'tighten-vs-waste',
      predicate: { name: 'WithinOne', test: (state) => state.value <= 1 },
      oppositePredicate: { name: 'AtLeastTwo', test: (state) => state.value >= 2 },
    }),
    breakVsRepair: createInversionPair({
      name: 'break-vs-repair',
      predicate: { name: 'Repair', test: (state) => state.value <= 1 },
      oppositePredicate: { name: 'Break', test: (state) => state.value === 0 },
    }),
    truthMinVsTruthMax: createInversionPair({
      name: 'truth-min-vs-max',
      predicate: { name: 'TruthMin', test: (state) => state.value >= 0 },
      oppositePredicate: { name: 'TruthMax', test: (state) => state.value > 10 },
    }),
  },
});
```

## Directory docs

- [src/README.md](./src/README.md)
- [test/README.md](./test/README.md)
