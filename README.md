# aeon-logic

Fork/race/fold temporal logic engine with TLC/TLA compatibility helpers.

## What it provides

- A finite-state model checker with:
  - invariant checking
  - eventual (`<>`) property checking
  - weak fairness filtering (`WF`) for liveness counterexamples
- TLC config (`.cfg`) parsing and serialization
- TLA module (`.tla`) parsing and rendering
- WASM-friendly TLA sandbox runner (`runTlaSandbox`) with module/config partitioning
- Checker trace adapters to TLC-like text and JSON representations
- Logic-chain superposition primitives:
  - superposition/fork expansion
  - branch interference (constructive/destructive)
  - measurement policies (argmax, quorum, merge)
- Advanced composition helpers:
  - complex-amplitude superposition chains
  - checker topology event bridge for `TopologySampler` sinks
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
```

## Directory docs

- [src/README.md](./src/README.md)
- [test/README.md](./test/README.md)
