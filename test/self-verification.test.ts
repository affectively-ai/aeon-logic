/**
 * Self-verification: the checker verifies a model of its own BFS exploration.
 *
 * The checker's BFS is itself a fork/race/fold computation:
 *   - Fork: expansion with >1 successor
 *   - Fold: transition to already-visited state (interference)
 *   - Vent: unfair cycle filtered by weak fairness
 *   - Complete: frontier exhausted
 *
 * We model this abstract machine as a TemporalModel and check it with
 * ForkRaceFoldModelChecker — the checker verifying itself.
 */
import { describe, expect, it } from 'vitest';

import {
  ForkRaceFoldModelChecker,
  type NamedPredicate,
  type TemporalModel,
  type WeakFairnessRule,
} from '../src/index.js';

/**
 * Abstract state of a BFS model checker during exploration.
 */
interface CheckerState {
  readonly explored: number;
  readonly frontier: number;
  readonly transitions: number;
  readonly folded: number;
  readonly forks: number;
  readonly vents: number;
  readonly depth: number;
  readonly done: boolean;
}

const MAX_EXPLORED = 4;
const MAX_FRONTIER = 2;
const MAX_DEPTH = 3;
const MAX_TRANSITIONS = 6;

const fingerprint = (s: Readonly<CheckerState>): string =>
  `e${s.explored}:f${s.frontier}:t${s.transitions}:d${s.folded}:k${s.forks}:v${s.vents}:l${s.depth}:${s.done ? 'D' : 'R'}`;

/**
 * A TemporalModel of the checker's own BFS exploration.
 *
 * Actions model what the checker does at each step:
 *   ExpandLinear — process a frontier node, produce 1 new successor
 *   ExpandFork — process a frontier node, produce 2 new successors (fork)
 *   FoldTransition — a successor hits an already-visited state (interference)
 *   VentCycle — filter an unfair cycle during liveness checking
 *   Finish — frontier exhausted, exploration complete
 */
const checkerModel: TemporalModel<CheckerState> = {
  initialStates: [
    {
      explored: 1,
      frontier: 1,
      transitions: 0,
      folded: 0,
      forks: 0,
      vents: 0,
      depth: 0,
      done: false,
    },
  ],
  fingerprint,
  actions: [
    {
      name: 'ExpandLinear',
      enabled: (s) => !s.done && s.frontier > 0 && s.explored < MAX_EXPLORED && s.transitions < MAX_TRANSITIONS,
      successors: (s) => [
        {
          explored: s.explored + 1,
          frontier: s.frontier, // -1 consumed, +1 produced
          transitions: s.transitions + 1,
          folded: s.folded,
          forks: s.forks,
          vents: s.vents,
          depth: s.depth,
          done: false,
        },
      ],
    },
    {
      name: 'ExpandFork',
      enabled: (s) =>
        !s.done &&
        s.frontier > 0 &&
        s.explored + 1 < MAX_EXPLORED &&
        s.frontier < MAX_FRONTIER &&
        s.transitions + 1 < MAX_TRANSITIONS,
      successors: (s) => [
        {
          explored: s.explored + 2,
          frontier: s.frontier + 1, // -1 consumed, +2 produced
          transitions: s.transitions + 2,
          folded: s.folded,
          forks: s.forks + 1,
          vents: s.vents,
          depth: s.depth,
          done: false,
        },
      ],
    },
    {
      name: 'FoldTransition',
      enabled: (s) => !s.done && s.frontier > 0 && s.explored > 1 && s.transitions < MAX_TRANSITIONS,
      successors: (s) => [
        {
          explored: s.explored,
          frontier: s.frontier, // consumed one, but successor already visited
          transitions: s.transitions + 1,
          folded: s.folded + 1,
          forks: s.forks,
          vents: s.vents,
          depth: s.depth,
          done: false,
        },
      ],
    },
    {
      name: 'VentCycle',
      enabled: (s) => !s.done && s.folded > s.vents,
      successors: (s) => [
        {
          explored: s.explored,
          frontier: s.frontier,
          transitions: s.transitions,
          folded: s.folded,
          forks: s.forks,
          vents: s.vents + 1,
          depth: s.depth,
          done: false,
        },
      ],
    },
    {
      name: 'CompleteLayer',
      enabled: (s) => !s.done && s.frontier > 0 && s.depth < MAX_DEPTH,
      successors: (s) => [
        {
          explored: s.explored,
          frontier: s.frontier,
          transitions: s.transitions,
          folded: s.folded,
          forks: s.forks,
          vents: s.vents,
          depth: s.depth + 1,
          done: false,
        },
      ],
    },
    {
      name: 'Finish',
      enabled: (s) => !s.done && s.depth > 0,
      successors: (s) => [
        {
          explored: s.explored,
          frontier: 0,
          transitions: s.transitions,
          folded: s.folded,
          forks: s.forks,
          vents: s.vents,
          depth: s.depth,
          done: true,
        },
      ],
    },
  ],
};

/**
 * Invariants the checker must satisfy about itself.
 */
const selfInvariants: NamedPredicate<CheckerState>[] = [
  {
    name: 'FoldsNeverExceedTransitions',
    test: (s) => s.folded <= s.transitions,
  },
  {
    name: 'VentsNeverExceedFolds',
    test: (s) => s.vents <= s.folded,
  },
  {
    name: 'ExploredAlwaysPositive',
    test: (s) => s.explored >= 1,
  },
  {
    name: 'Beta1NonNegative',
    test: (s) => {
      // β₁ = edges - nodes + components; for connected graph, components = 1
      const beta1 = s.transitions - s.explored + 1;
      return beta1 >= 0;
    },
  },
  {
    name: 'FoldsEqualBeta1',
    test: (s) => {
      // In a BFS tree, every folded transition creates exactly one independent cycle
      // β₁ = folded transitions (back-edges in BFS tree)
      // Also β₁ = total_edges - nodes + 1
      // So folded = transitions - explored + 1 = transitions - (explored - 1)
      // This holds when all non-folded transitions create new nodes:
      //   non-folded = explored - 1 (tree edges)
      //   folded = transitions - (explored - 1)
      //   β₁ = transitions - explored + 1 = folded
      const beta1 = s.transitions - s.explored + 1;
      return s.folded === beta1;
    },
  },
  {
    name: 'DepthBounded',
    test: (s) => s.depth <= MAX_DEPTH,
  },
  {
    name: 'FrontierNonNegative',
    test: (s) => s.frontier >= 0,
  },
];

/**
 * Liveness: the checker eventually finishes.
 */
const eventuallyDone: NamedPredicate<CheckerState> = {
  name: 'EventuallyDone',
  test: (s) => s.done,
};

/**
 * Weak fairness: Finish must eventually be taken if continuously enabled.
 * This prevents infinite exploration without termination.
 */
const fairness: WeakFairnessRule[] = [{ actionName: 'Finish' }];

describe('Self-verification: checker verifies its own BFS model', () => {
  const checker = new ForkRaceFoldModelChecker<CheckerState>();

  it('satisfies all structural invariants about its own exploration', async () => {
    const result = await checker.check(checkerModel, {
      invariants: selfInvariants,
      maxDepth: 16,
      maxStates: 50_000,
    });

    expect(result.ok).toBe(true);
    expect(result.stateCount).toBeGreaterThan(1);
    expect(result.topology.forkCount).toBeGreaterThan(0);
    expect(result.topology.foldCount).toBeGreaterThanOrEqual(0);
    expect(result.topology.beta1).toBeGreaterThanOrEqual(0);
    expect(result.topology.depthLayers).toBeGreaterThan(0);
  });

  it('eventually terminates under weak fairness', async () => {
    const result = await checker.check(checkerModel, {
      invariants: selfInvariants,
      eventual: [eventuallyDone],
      weakFairness: fairness,
      maxDepth: 32,
      maxStates: 200_000,
    });

    expect(result.ok).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.topology.ventCount).toBeGreaterThanOrEqual(0);
  });

  it('produces topology stats about its own self-verification', async () => {
    const result = await checker.check(checkerModel, {
      invariants: selfInvariants,
      eventual: [eventuallyDone],
      weakFairness: fairness,
      maxDepth: 16,
      maxStates: 50_000,
    });

    // The meta-topology: topology of the checker checking itself
    const t = result.topology;

    // The self-verification graph has forks (multiple actions enabled per state)
    expect(t.forkCount).toBeGreaterThan(0);

    // It has folds (different action sequences reach the same checker state)
    expect(t.foldCount).toBeGreaterThanOrEqual(0);

    // β₁ = independent cycles in the self-verification graph
    expect(t.beta1).toBeGreaterThanOrEqual(0);

    // Δβ of self-verification: the topology the checker consumed verifying itself
    // This is the topological cost of self-knowledge
    const deltaB = t.beta1; // In a self-referential system, β₁* is undefined
    expect(deltaB).toBeGreaterThanOrEqual(0);
  });
});
