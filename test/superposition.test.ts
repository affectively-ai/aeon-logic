import { describe, expect, it } from 'vitest';

import { LogicChainSuperposition } from '../src/index.js';

describe('LogicChainSuperposition', () => {
  it('fork preserves total probability with equal candidate weights', () => {
    const forked = LogicChainSuperposition.seed({ value: 0 }).fork(() => [
      { state: { value: 1 }, step: 'left' },
      { state: { value: -1 }, step: 'right' },
    ]);

    expect(forked.chains).toHaveLength(2);
    expect(forked.totalProbability()).toBeCloseTo(1, 12);
    expect(forked.chains.map((chain) => chain.steps[0])).toEqual(['left', 'right']);
  });

  it('relative amplitudes bias probabilities deterministically', () => {
    const forked = LogicChainSuperposition.seed('start').fork(() => [
      { id: 'A', state: 'A', relativeAmplitude: 3 },
      { id: 'B', state: 'B', relativeAmplitude: 1 },
    ]);

    const distribution = forked.distribution();
    const branchA = distribution.find((entry) => entry.chain.id === 'A');
    const branchB = distribution.find((entry) => entry.chain.id === 'B');

    expect(branchA?.probability).toBeCloseTo(0.9, 12);
    expect(branchB?.probability).toBeCloseTo(0.1, 12);
  });

  it('interfere cancels opposite-phase branches with matching state keys', () => {
    const amplitude = Math.sqrt(0.5);
    const superposed = LogicChainSuperposition.fromChains<string>([
      {
        id: 'a',
        state: 'same',
        steps: [],
        amplitude,
        phase: 1,
        parentId: null,
        depth: 0,
      },
      {
        id: 'b',
        state: 'same',
        steps: [],
        amplitude,
        phase: -1,
        parentId: null,
        depth: 0,
      },
    ]);

    const interfered = superposed.interfere();
    expect(interfered.chains).toHaveLength(0);
    expect(interfered.totalProbability()).toBe(0);
  });

  it('argmax measurement picks highest-probability chain', () => {
    const forked = LogicChainSuperposition.seed('root').fork(() => [
      { id: 'fast', state: 'fast', relativeAmplitude: 4 },
      { id: 'slow', state: 'slow', relativeAmplitude: 1 },
    ]);

    const measured = forked.measureArgmax();
    expect(measured?.id).toBe('fast');
  });

  it('quorum measurement reports satisfied and unsatisfied cases', () => {
    const superposed = LogicChainSuperposition.fromChains<{ mode: string }>([
      {
        id: 'a',
        state: { mode: 'accept' },
        steps: [],
        amplitude: Math.sqrt(0.7),
        phase: 1,
        parentId: null,
        depth: 0,
      },
      {
        id: 'b',
        state: { mode: 'accept' },
        steps: [],
        amplitude: Math.sqrt(0.2),
        phase: 1,
        parentId: null,
        depth: 0,
      },
      {
        id: 'c',
        state: { mode: 'reject' },
        steps: [],
        amplitude: Math.sqrt(0.1),
        phase: 1,
        parentId: null,
        depth: 0,
      },
    ]);

    const satisfied = superposed.measureQuorum((state) => state.mode, 0.75);
    expect(satisfied.satisfied).toBe(true);
    expect(satisfied.winningKey).toBe('accept');
    expect(satisfied.probability).toBeCloseTo(0.9, 12);

    const unsatisfied = superposed.measureQuorum((state) => state.mode, 0.95);
    expect(unsatisfied.satisfied).toBe(false);
    expect(unsatisfied.winningKey).toBeUndefined();
    expect(unsatisfied.probability).toBeCloseTo(0.9, 12);
  });

  it('merge measurement can collapse weighted chains to a scalar', () => {
    const superposed = LogicChainSuperposition.fromChains<number>([
      {
        id: 'x',
        state: 10,
        steps: [],
        amplitude: Math.sqrt(0.25),
        phase: 1,
        parentId: null,
        depth: 0,
      },
      {
        id: 'y',
        state: 30,
        steps: [],
        amplitude: Math.sqrt(0.75),
        phase: 1,
        parentId: null,
        depth: 0,
      },
    ]);

    const weightedAverage = superposed.measureMerge((entries) =>
      entries.reduce(
        (sum, entry) => sum + entry.chain.state * entry.probability,
        0,
      ),
    );

    expect(weightedAverage).toBeCloseTo(25, 12);
  });
});
