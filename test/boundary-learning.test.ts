import { describe, expect, it } from 'vitest';

import {
  createInversionPair,
  runBoundaryLearningSuite,
  runBoundarySweep,
  runInversionCheck,
  type TemporalModel,
} from '../src/index.js';

interface CounterState {
  readonly value: number;
}

function buildCounterModel(maxValue: number): TemporalModel<CounterState> {
  return {
    initialStates: [{ value: 0 }],
    fingerprint: (state) => `${state.value}`,
    actions: [
      {
        name: 'Step',
        enabled: (state) => state.value < maxValue,
        successors: (state) => [{ value: state.value + 1 }],
      },
    ],
  };
}

describe('boundary-learning', () => {
  it('creates a deterministic inversion pair with default opposite predicate', () => {
    const pair = createInversionPair<CounterState>({
      name: 'default-opposite',
      predicate: {
        name: 'NonNegative',
        test: (state) => state.value >= 0,
      },
    });

    expect(pair.id).toContain('default-opposite');
    expect(pair.claim.name).toBe('NonNegative');
    expect(pair.opposite.name).toBe('NonNegative_opposite');
    expect(pair.opposite.test({ value: 0 })).toBe(false);
    expect(pair.opposite.test({ value: -1 })).toBe(true);
  });

  it('runs inversion checks and returns traces for failing predicates', async () => {
    const model = buildCounterModel(2);

    const pair = createInversionPair<CounterState>({
      name: 'trace-check',
      predicate: {
        name: 'WithinOne',
        test: (state) => state.value <= 1,
      },
      oppositePredicate: {
        name: 'AtLeastTwo',
        test: (state) => state.value >= 2,
      },
    });

    const outcome = await runInversionCheck(model, pair, { maxDepth: 2 });

    expect(outcome.claim.satisfied).toBe(false);
    expect(outcome.claim.firstTrace?.length).toBeGreaterThan(0);
    expect(outcome.opposite.satisfied).toBe(false);
    expect(typeof outcome.separationDelta).toBe('number');
  });

  it('detects depth frontiers where inversion signatures flip', async () => {
    const model = buildCounterModel(3);

    const pair = createInversionPair<CounterState>({
      name: 'frontier-check',
      predicate: {
        name: 'WithinOne',
        test: (state) => state.value <= 1,
      },
      oppositePredicate: {
        name: 'OnlyZero',
        test: (state) => state.value === 0,
      },
    });

    const sweep = await runBoundarySweep({
      model,
      pair,
      depth: { min: 1, max: 3, step: 1 },
      pressure: { min: 0, max: 1, step: 1 },
    });

    expect(sweep.points.length).toBe(6);
    expect(sweep.frontiers.length).toBeGreaterThan(0);
    expect(sweep.frontiers.some((frontier) => frontier.axis === 'depth')).toBe(true);
  });

  it('runs one-shot boundary learning suite and returns actionable report', async () => {
    const model = buildCounterModel(3);

    const report = await runBoundaryLearningSuite({
      model,
      depth: { min: 1, max: 3, step: 1 },
      pressure: { min: 0, max: 1, step: 1 },
      suite: {
        tightenVsWaste: createInversionPair<CounterState>({
          name: 'tighten-vs-waste',
          predicate: {
            name: 'WithinOne',
            test: (state) => state.value <= 1,
          },
          oppositePredicate: {
            name: 'AtLeastTwo',
            test: (state) => state.value >= 2,
          },
        }),
        breakVsRepair: createInversionPair<CounterState>({
          name: 'break-vs-repair',
          predicate: {
            name: 'WithinOneRepair',
            test: (state) => state.value <= 1,
          },
          oppositePredicate: {
            name: 'OnlyZeroBreak',
            test: (state) => state.value === 0,
          },
        }),
        truthMinVsTruthMax: createInversionPair<CounterState>({
          name: 'truth-min-vs-max',
          predicate: {
            name: 'NonNegativeTruth',
            test: (state) => state.value >= 0,
          },
          oppositePredicate: {
            name: 'ImpossibleTruth',
            test: (state) => state.value > 10,
          },
        }),
      },
    });

    expect(report.tightenVsWaste.pairName).toBe('tighten-vs-waste');
    expect(report.breakVsRepair.pairName).toBe('break-vs-repair');
    expect(report.truthMinVsTruthMax.pairName).toBe('truth-min-vs-max');
    expect(report.breakVsRepairFrontiers.length).toBeGreaterThan(0);
    expect(report.nextProbes.length).toBeGreaterThan(0);
  });
});
