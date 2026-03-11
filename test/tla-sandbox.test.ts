import { describe, expect, it } from 'vitest';

import {
  partitionTlaSandboxArtifacts,
  runTlaSandbox,
} from '../src/index.js';

const SAMPLE_TLA_MODULE = `------------------------------ MODULE TriangleOrder ------------------------------
EXTENDS Naturals, Sequences

VARIABLES entered, exited

Init == /\\ entered = <<1, 2, 3>>
        /\\ exited = <<1, 2, 3>>

OrderPreserved == entered = exited
Spec == Init /\\ []OrderPreserved

=============================================================================
`;

const SAMPLE_TLC_CONFIG = `SPECIFICATION Spec
INVARIANTS
  OrderPreserved
`;

describe('TLA sandbox helpers', () => {
  it('partitions module and trailing config from one payload', () => {
    const artifacts = partitionTlaSandboxArtifacts(
      `${SAMPLE_TLA_MODULE}\n${SAMPLE_TLC_CONFIG}`,
    );

    expect(artifacts.tlaSource).not.toBeNull();
    expect(artifacts.tlaSource).toContain('MODULE TriangleOrder');
    expect(artifacts.tlcConfigSource).toContain('SPECIFICATION Spec');
  });

  it('runs module parser round-trip checks in sandbox mode', () => {
    const result = runTlaSandbox(SAMPLE_TLA_MODULE);

    expect(result.report.mode).toBe('tla-sandbox');
    expect(result.report.runtime).toBe('wasm-js');
    expect(result.report.module?.name).toBe('TriangleOrder');
    expect(result.report.module?.roundTripStable).toBe(true);
    expect(result.logs).toContain('Parsing TLA module...');
    expect(result.report.config).toBeUndefined();
  });

  it('runs config parser round-trip checks when only cfg is supplied', () => {
    const result = runTlaSandbox(SAMPLE_TLC_CONFIG);

    expect(result.report.module).toBeUndefined();
    expect(result.report.config?.invariants).toBe(1);
    expect(result.report.config?.roundTripStable).toBe(true);
    expect(result.logs).toContain('Parsing TLC config...');
  });

  it('throws when payload is empty', () => {
    expect(() => runTlaSandbox(' \n\t  ')).toThrow(
      'No TLA module or TLC config content was provided.',
    );
  });
});
