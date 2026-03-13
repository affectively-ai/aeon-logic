# Source

- Parent README: [../README.md](../README.md)

Core library modules:

- `types.ts`: checker contracts, result types, and wavefront diagnostics.
- `checker.ts`: fork/race/fold model checker with frontier-fill reporting.
- `superposition.ts`: logic-chain superposition, interference, and measurement primitives.
- `complex-superposition.ts`: complex-amplitude superposition primitives.
- `temporal-formula.ts`: temporal formula parser/compiler (`always`, `eventually`, `eventually@q`, `until`, `until@q`).
- `topology-bridge.ts`: checker-event bridge for `TopologySampler`-style sinks.
- `flow-bridge.ts`: chain-to-stream bridge for Aeon Flow-style transports.
- `superposition-artifacts.ts`: generated TLA/CFG artifact pairs for superposition scenarios.
- `tlc-cfg.ts`: TLC `.cfg` parser and serializer.
- `tla-module.ts`: TLA `.tla` module parser and renderer.
- `tla-sandbox.ts`: WASM-friendly TLA sandbox runner and module/config artifact partitioning.
- `browser.ts`: browser-safe entry that exposes only TLA sandbox helpers without Node-only Lean tooling.
- `lean-sandbox.ts`: Lean project discovery, metadata inspection, and optional `lake build` execution.
- `tlc-trace.ts`: checker trace adapters for TLC-compatible text/JSON.
- `tlc-artifacts.ts`: convenience renderer for `.tla` + `.cfg` artifact pairs.
- `gg.ts`: native `.gg` parsing, topology analysis, model conversion, and check helpers.
- `boundary-learning.ts`: inversion pair generation, boundary sweeps, and one-shot learning reports.
- `index.ts`: public exports.
