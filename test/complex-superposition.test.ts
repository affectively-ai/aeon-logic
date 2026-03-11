import { describe, expect, it } from 'vitest';

import { ComplexLogicChainSuperposition } from '../src/index.js';

describe('ComplexLogicChainSuperposition', () => {
  it('fork normalizes candidate coefficients', () => {
    const forked = ComplexLogicChainSuperposition.seed('root').fork(() => [
      { id: 'a', state: 'a', relativeCoefficient: { re: 3, im: 0 } },
      { id: 'b', state: 'b', relativeCoefficient: { re: 4, im: 0 } },
    ]);

    const distribution = forked.distribution();
    const probA = distribution.find((entry) => entry.chain.id === 'a')?.probability;
    const probB = distribution.find((entry) => entry.chain.id === 'b')?.probability;

    expect(probA).toBeCloseTo(0.36, 12);
    expect(probB).toBeCloseTo(0.64, 12);
  });

  it('destructive interference cancels equal-opposite coefficients', () => {
    const superposed = ComplexLogicChainSuperposition.fromChains<string>([
      {
        id: 'p',
        state: 'same',
        steps: [],
        coefficient: { re: 1 / Math.sqrt(2), im: 0 },
        parentId: null,
        depth: 0,
      },
      {
        id: 'n',
        state: 'same',
        steps: [],
        coefficient: { re: -1 / Math.sqrt(2), im: 0 },
        parentId: null,
        depth: 0,
      },
    ]);

    const interfered = superposed.interfere();
    expect(interfered.chains).toHaveLength(0);
    expect(interfered.totalProbability()).toBeCloseTo(0, 12);
  });

  it('handles non-trivial phase without cancellation', () => {
    const superposed = ComplexLogicChainSuperposition.fromChains<string>([
      {
        id: 'r',
        state: 'same',
        steps: [],
        coefficient: { re: 1 / Math.sqrt(2), im: 0 },
        parentId: null,
        depth: 0,
      },
      {
        id: 'i',
        state: 'same',
        steps: [],
        coefficient: { re: 0, im: 1 / Math.sqrt(2) },
        parentId: null,
        depth: 0,
      },
    ]);

    const interfered = superposed.interfere();
    expect(interfered.chains).toHaveLength(1);
    expect(interfered.totalProbability()).toBeCloseTo(1, 12);
  });

  it('supports quorum measurement over complex amplitudes', () => {
    const superposed = ComplexLogicChainSuperposition.fromChains<{ vote: string }>([
      {
        id: 'yes-1',
        state: { vote: 'yes' },
        steps: [],
        coefficient: { re: Math.sqrt(0.5), im: 0 },
        parentId: null,
        depth: 0,
      },
      {
        id: 'yes-2',
        state: { vote: 'yes' },
        steps: [],
        coefficient: { re: Math.sqrt(0.3), im: 0 },
        parentId: null,
        depth: 0,
      },
      {
        id: 'no-1',
        state: { vote: 'no' },
        steps: [],
        coefficient: { re: Math.sqrt(0.2), im: 0 },
        parentId: null,
        depth: 0,
      },
    ]);

    const quorum = superposed.measureQuorum((state) => state.vote, 0.75);
    expect(quorum.satisfied).toBe(true);
    expect(quorum.winningKey).toBe('yes');
    expect(quorum.probability).toBeCloseTo(0.8, 12);
  });
});
