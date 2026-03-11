import { describe, expect, it } from 'vitest';

import {
  ForkRaceFoldModelChecker,
  collectTopologyEvents,
  type NamedPredicate,
  type TemporalModel,
} from '../src/index.js';

interface CounterState {
  readonly value: number;
}

const counterFingerprint = (state: Readonly<CounterState>): string => `${state.value}`;

function buildWaitAdvanceModel(maxValue: number): TemporalModel<CounterState> {
  return {
    initialStates: [{ value: 0 }],
    fingerprint: counterFingerprint,
    actions: [
      {
        name: 'Wait',
        successors: (state) => [{ value: state.value }],
      },
      {
        name: 'Advance',
        enabled: (state) => state.value < maxValue,
        successors: (state) => [{ value: state.value + 1 }],
      },
    ],
  };
}

describe('ForkRaceFoldModelChecker', () => {
  it('reports the first invariant violation with trace', async () => {
    const checker = new ForkRaceFoldModelChecker<CounterState>();
    const model: TemporalModel<CounterState> = {
      initialStates: [{ value: -1 }],
      fingerprint: counterFingerprint,
      actions: [],
    };

    const invariants: readonly NamedPredicate<CounterState>[] = [
      {
        name: 'NonNegative',
        test: (state) => state.value >= 0,
      },
    ];

    const result = await checker.check(model, { invariants });

    expect(result.ok).toBe(false);
    expect(result.violations[0]?.kind).toBe('invariant');
    expect(result.violations[0]?.name).toBe('NonNegative');
    expect(result.violations[0]?.trace.map((step) => step.stateId)).toEqual(['-1']);
  });

  it('finds eventual violation on a reachable fair cycle', async () => {
    const checker = new ForkRaceFoldModelChecker<CounterState>();
    const model = buildWaitAdvanceModel(2);

    const result = await checker.check(model, {
      eventual: [{ name: 'ReachedTwo', test: (state) => state.value === 2 }],
      maxDepth: 8,
    });

    expect(result.ok).toBe(false);
    expect(result.complete).toBe(true);
    expect(result.violations[0]?.kind).toBe('eventual');
    expect((result.violations[0]?.cycleStateIds?.length ?? 0) > 0).toBe(true);
  });

  it('respects weak fairness and suppresses unfair liveness counterexamples', async () => {
    const checker = new ForkRaceFoldModelChecker<CounterState>();
    const model = buildWaitAdvanceModel(2);

    const result = await checker.check(model, {
      eventual: [{ name: 'ReachedTwo', test: (state) => state.value === 2 }],
      weakFairness: [{ actionName: 'Advance' }],
      maxDepth: 8,
    });

    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('counts folded transitions when multiple edges hit an existing state', async () => {
    const checker = new ForkRaceFoldModelChecker<CounterState>();
    const model: TemporalModel<CounterState> = {
      initialStates: [{ value: 0 }],
      fingerprint: counterFingerprint,
      actions: [
        {
          name: 'RouteA',
          enabled: (state) => state.value === 0,
          successors: () => [{ value: 1 }],
        },
        {
          name: 'RouteB',
          enabled: (state) => state.value === 0,
          successors: () => [{ value: 1 }],
        },
      ],
    };

    const result = await checker.check(model, { maxDepth: 2 });

    expect(result.ok).toBe(true);
    expect(result.stateCount).toBe(2);
    expect(result.stats.transitionsExplored).toBe(2);
    expect(result.stats.foldedTransitions).toBe(1);
  });

  it('stays deterministic across concurrency settings', async () => {
    interface DiamondState {
      readonly step: 0 | 1 | 2 | 3;
    }

    const checker = new ForkRaceFoldModelChecker<DiamondState>();

    const model: TemporalModel<DiamondState> = {
      initialStates: [{ step: 0 }],
      fingerprint: (state) => `${state.step}`,
      actions: [
        {
          name: 'A',
          enabled: (state) => state.step === 0,
          successors: () => [{ step: 1 }],
        },
        {
          name: 'B',
          enabled: (state) => state.step === 0,
          successors: () => [{ step: 2 }],
        },
        {
          name: 'C',
          enabled: (state) => state.step === 1,
          successors: () => [{ step: 3 }],
        },
        {
          name: 'D',
          enabled: (state) => state.step === 2,
          successors: () => [{ step: 3 }],
        },
      ],
    };

    const invariants: readonly NamedPredicate<DiamondState>[] = [
      {
        name: 'NoStepThree',
        test: (state) => state.step !== 3,
      },
    ];

    const serialResult = await checker.check(model, {
      invariants,
      concurrency: 1,
      maxDepth: 4,
    });
    const parallelResult = await checker.check(model, {
      invariants,
      concurrency: 8,
      maxDepth: 4,
    });

    expect(serialResult.ok).toBe(false);
    expect(parallelResult.ok).toBe(false);
    expect(
      serialResult.violations[0]?.trace.map((step: { readonly stateId: string }) => step.stateId),
    ).toEqual([
      '0',
      '1',
      '3',
    ]);
    expect(
      parallelResult.violations[0]?.trace.map(
        (step: { readonly stateId: string }) => step.stateId,
      ),
    ).toEqual(
      serialResult.violations[0]?.trace.map(
        (step: { readonly stateId: string }) => step.stateId,
      ),
    );
    expect(parallelResult.stats).toEqual(serialResult.stats);
  });

  it('supports superposition frontier cancellation with topology events', async () => {
    interface BranchState {
      readonly step: 'root' | 'target';
    }

    const checker = new ForkRaceFoldModelChecker<BranchState>();
    const topology = collectTopologyEvents();

    const model: TemporalModel<BranchState> = {
      initialStates: [{ step: 'root' }],
      fingerprint: (state) => state.step,
      actions: [
        {
          name: 'Split',
          enabled: (state) => state.step === 'root',
          successors: () => [{ step: 'target' }, { step: 'target' }],
        },
      ],
    };

    const result = await checker.check(model, {
      eventual: [{ name: 'ReachTarget', test: (state) => state.step === 'target' }],
      superposition: {
        enabled: true,
        branchPhase: (context) => (context.successorIndex === 0 ? 1 : -1),
        onTopologyEvent: topology.sink,
      },
      maxDepth: 4,
    });

    expect(result.ok).toBe(false);
    expect(result.violations[0]?.kind).toBe('eventual');
    expect(topology.events.some((event) => event.type === 'fork')).toBe(true);
    expect(topology.events.some((event) => event.type === 'vent')).toBe(true);
    expect(topology.events.some((event) => event.type === 'fold')).toBe(true);
  });

  it('supports quorum-based eventual properties in superposition mode', async () => {
    interface VoteState {
      readonly branch: 'seed' | 'yes' | 'no';
    }

    const checker = new ForkRaceFoldModelChecker<VoteState>();
    const model: TemporalModel<VoteState> = {
      initialStates: [{ branch: 'seed' }],
      fingerprint: (state) => state.branch,
      actions: [
        {
          name: 'Poll',
          successors: () => [
            { branch: 'yes' },
            { branch: 'yes' },
            { branch: 'no' },
          ],
        },
      ],
    };

    const result = await checker.check(model, {
      eventualQuorum: [
        {
          name: 'YesQuorum',
          keyOfState: (state) => state.branch,
          threshold: 0.66,
          isGoalKey: (key) => key === 'yes',
        },
      ],
      superposition: { enabled: true },
      maxDepth: 3,
    });

    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('includes quantum metadata in violation traces', async () => {
    const checker = new ForkRaceFoldModelChecker<CounterState>();
    const model: TemporalModel<CounterState> = {
      initialStates: [{ value: -1 }],
      fingerprint: counterFingerprint,
      actions: [],
    };

    const result = await checker.check(model, {
      invariants: [{ name: 'NonNegative', test: (state) => state.value >= 0 }],
      superposition: { enabled: true },
    });

    const firstStep = result.violations[0]?.trace[0];
    expect(firstStep?.quantum).toBeDefined();
    expect(firstStep?.quantum?.amplitude).toBeCloseTo(1, 12);
    expect(firstStep?.quantum?.probability).toBeCloseTo(1, 12);
  });
});
