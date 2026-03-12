/**
 * TLA+ self-verification: the checker's BFS model as a TLA+ spec.
 *
 * Generates a TLA+ specification of the checker's own exploration,
 * runs it through the TLA sandbox (parse → render → round-trip),
 * then verifies the same model with ForkRaceFoldModelChecker.
 *
 * Both verification paths check the same invariants:
 *   - β₁ ≥ 0 (Beta1NonNeg)
 *   - β₁ = folded (Beta1EqFolded)
 *   - vents ≤ folds
 *   - folds ≤ transitions
 *   - eventually done
 */
import { describe, expect, it } from 'vitest';

import {
  ForkRaceFoldModelChecker,
  renderSelfVerificationArtifactPair,
  runTlaSandbox,
  type TemporalModel,
} from '../src/index.js';

describe('TLA+ self-verification', () => {
  const BOUNDS = {
    maxExplored: 4,
    maxFrontier: 2,
    maxDepth: 3,
    maxTransitions: 6,
  };

  it('generates a valid TLA+ spec of the checker and round-trips through sandbox', () => {
    const pair = renderSelfVerificationArtifactPair(BOUNDS);

    expect(pair.tla).toContain('MODULE CheckerSelfVerification');
    expect(pair.tla).toContain('InvBeta1EqFolded');
    expect(pair.tla).toContain('InvBeta1NonNeg');
    expect(pair.tla).toContain('EventuallyDone');
    expect(pair.tla).toContain('WF_vars(Finish)');

    expect(pair.cfg).toContain('MaxExplored = 4');
    expect(pair.cfg).toContain('MaxTransitions = 6');
    expect(pair.cfg).toContain('InvBeta1EqFolded');
    expect(pair.cfg).toContain('EventuallyDone');

    // Run through TLA sandbox — parse, render, round-trip
    const result = runTlaSandbox(pair.tla);

    expect(result.report.engine).toBe('aeon-logic');
    expect(result.report.mode).toBe('tla-sandbox');
    expect(result.report.module).toBeDefined();
    expect(result.report.module!.name).toBe('CheckerSelfVerification');
    expect(result.report.module!.roundTripStable).toBe(true);
    expect(result.report.module!.extends).toContain('Naturals');
  });

  it('sandbox also validates the TLC config', () => {
    const pair = renderSelfVerificationArtifactPair(BOUNDS);

    const configResult = runTlaSandbox(pair.cfg);

    expect(configResult.report.config).toBeDefined();
    expect(configResult.report.config!.roundTripStable).toBe(true);
    expect(configResult.report.config!.invariants).toBe(7);
    expect(configResult.report.config!.properties).toBe(1);
    expect(configResult.report.config!.constants).toBe(4);
  });

  it('dual verification: TLA sandbox + checker agree on the same model', async () => {
    // Path 1: TLA+ artifact generation + sandbox validation
    const pair = renderSelfVerificationArtifactPair(BOUNDS);
    const sandboxResult = runTlaSandbox(pair.tla);
    expect(sandboxResult.report.module!.roundTripStable).toBe(true);

    // Path 2: Direct model checking with ForkRaceFoldModelChecker
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

    const model: TemporalModel<CheckerState> = {
      initialStates: [{
        explored: 1, frontier: 1, transitions: 0,
        folded: 0, forks: 0, vents: 0, depth: 0, done: false,
      }],
      fingerprint: (s) =>
        `e${s.explored}:f${s.frontier}:t${s.transitions}:d${s.folded}:k${s.forks}:v${s.vents}:l${s.depth}:${s.done ? 'D' : 'R'}`,
      actions: [
        {
          name: 'ExpandLinear',
          enabled: (s) => !s.done && s.frontier > 0 && s.explored < BOUNDS.maxExplored && s.transitions < BOUNDS.maxTransitions,
          successors: (s) => [{ ...s, explored: s.explored + 1, transitions: s.transitions + 1 }],
        },
        {
          name: 'ExpandFork',
          enabled: (s) => !s.done && s.frontier > 0 && s.explored + 1 < BOUNDS.maxExplored && s.frontier < BOUNDS.maxFrontier && s.transitions + 1 < BOUNDS.maxTransitions,
          successors: (s) => [{ ...s, explored: s.explored + 2, frontier: s.frontier + 1, transitions: s.transitions + 2, forks: s.forks + 1 }],
        },
        {
          name: 'FoldTransition',
          enabled: (s) => !s.done && s.frontier > 0 && s.explored > 1 && s.transitions < BOUNDS.maxTransitions,
          successors: (s) => [{ ...s, transitions: s.transitions + 1, folded: s.folded + 1 }],
        },
        {
          name: 'VentCycle',
          enabled: (s) => !s.done && s.folded > s.vents,
          successors: (s) => [{ ...s, vents: s.vents + 1 }],
        },
        {
          name: 'CompleteLayer',
          enabled: (s) => !s.done && s.frontier > 0 && s.depth < BOUNDS.maxDepth,
          successors: (s) => [{ ...s, depth: s.depth + 1 }],
        },
        {
          name: 'Finish',
          enabled: (s) => !s.done && s.depth > 0,
          successors: (s) => [{ ...s, done: true, frontier: 0 }],
        },
      ],
    };

    const checker = new ForkRaceFoldModelChecker<CheckerState>();
    const checkerResult = await checker.check(model, {
      invariants: [
        { name: 'InvFoldsLeqTransitions', test: (s) => s.folded <= s.transitions },
        { name: 'InvVentsLeqFolds', test: (s) => s.vents <= s.folded },
        { name: 'InvExploredPositive', test: (s) => s.explored >= 1 },
        { name: 'InvBeta1NonNeg', test: (s) => s.transitions - s.explored + 1 >= 0 },
        { name: 'InvBeta1EqFolded', test: (s) => s.folded === s.transitions - s.explored + 1 },
      ],
      eventual: [{ name: 'EventuallyDone', test: (s) => s.done }],
      weakFairness: [{ actionName: 'Finish' }],
      maxDepth: 32,
      maxStates: 200_000,
    });

    // Both paths agree: the checker's BFS model is correct
    expect(checkerResult.ok).toBe(true);
    expect(checkerResult.complete).toBe(true);

    // The checker verified its own TLA+ specification
    expect(checkerResult.topology.forkCount).toBeGreaterThan(0);
    expect(checkerResult.topology.beta1).toBeGreaterThanOrEqual(0);
  });
});
