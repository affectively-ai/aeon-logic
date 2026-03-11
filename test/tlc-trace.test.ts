import { describe, expect, it } from 'vitest';

import {
  checkerTraceToTlcJson,
  checkerTraceToTlcText,
  parseTlcTextTrace,
  toTlaValue,
  type TraceStep,
} from '../src/index.js';

interface ExampleState {
  readonly count: number;
  readonly done: boolean;
  readonly queue: readonly number[];
  readonly meta: {
    readonly owner: string;
  };
}

const exampleTrace: readonly TraceStep<ExampleState>[] = [
  {
    stateId: 's0',
    viaAction: null,
    state: {
      count: 0,
      done: false,
      queue: [1, 2],
      meta: { owner: 'alpha' },
    },
  },
  {
    stateId: 's1',
    viaAction: 'Step',
    state: {
      count: 1,
      done: true,
      queue: [2],
      meta: { owner: 'alpha' },
    },
  },
];

describe('TLC trace compatibility', () => {
  it('converts checker traces to TLC text format', () => {
    const textTrace = checkerTraceToTlcText(exampleTrace, (state) => state);

    expect(textTrace).toContain('State 1: <Initial predicate>');
    expect(textTrace).toContain('/\\ count = 0');
    expect(textTrace).toContain('/\\ done = FALSE');
    expect(textTrace).toContain('/\\ queue = <<1, 2>>');
    expect(textTrace).toContain('State 2: <Step>');
  });

  it('converts checker traces to TLC-like JSON payload', () => {
    const jsonTrace = checkerTraceToTlcJson(exampleTrace, (state) => state);

    expect(jsonTrace.format).toBe('tlc-trace/v1');
    expect(jsonTrace.states).toHaveLength(2);
    expect(jsonTrace.states[0]?.label).toBe('Initial predicate');
    expect(jsonTrace.states[1]?.label).toBe('Step');
    expect(jsonTrace.states[1]?.variables.count).toBe('1');
    expect(jsonTrace.states[0]?.variables.meta).toBe('[owner |-> "alpha"]');
  });

  it('parses TLC text traces back into structured states', () => {
    const textTrace = checkerTraceToTlcText(exampleTrace, (state) => state);
    const parsed = parseTlcTextTrace(textTrace);

    expect(parsed.states).toHaveLength(2);
    expect(parsed.states[0]?.variables.queue).toBe('<<1, 2>>');
    expect(parsed.states[1]?.variables.done).toBe('TRUE');
  });

  it('formats native values into TLA-compatible literals', () => {
    expect(toTlaValue(true)).toBe('TRUE');
    expect(toTlaValue([1, 2, 3])).toBe('<<1, 2, 3>>');
    expect(toTlaValue(new Set(['b', 'a']))).toBe('{"a", "b"}');
    expect(toTlaValue({ x: 1, y: false })).toBe('[x |-> 1, y |-> FALSE]');
  });

  it('can include quantum metadata in rendered TLC traces', () => {
    const root = exampleTrace[0];
    if (!root) {
      throw new Error('Expected example trace to contain an initial state');
    }

    const quantumTrace: readonly TraceStep<ExampleState>[] = [
      {
        ...root,
        quantum: { amplitude: 1, phase: 1, probability: 1 },
      },
    ];

    const textTrace = checkerTraceToTlcText(
      quantumTrace,
      (state) => state,
      { includeQuantum: true, quantumVariablePrefix: '__q_' },
    );

    expect(textTrace).toContain('/\\ __q_amplitude = 1');
    expect(textTrace).toContain('/\\ __q_phase = 1');
    expect(textTrace).toContain('/\\ __q_probability = 1');
  });
});
