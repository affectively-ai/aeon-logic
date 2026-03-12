import { describe, expect, it } from 'vitest';

import {
  ForkRaceFoldModelChecker,
  compileTemporalFormulaSet,
  compileTemporalFormulaText,
  mergeCompiledTemporalFormulasIntoCheckerOptions,
  parseTemporalFormula,
  parseTemporalFormulaSet,
  renderTemporalFormula,
  type TemporalModel,
} from '../src/index.js';

interface VoteState {
  readonly vote: 'seed' | 'yes' | 'no';
}

interface HoldDoneState {
  readonly hold: boolean;
  readonly done: boolean;
}

const voteModel: TemporalModel<VoteState> = {
  initialStates: [{ vote: 'seed' }],
  fingerprint: (state) => state.vote,
  actions: [
    {
      name: 'Poll',
      successors: () => [{ vote: 'yes' }, { vote: 'no' }],
    },
  ],
};

describe('Temporal formula parser', () => {
  it('parses always/eventually operators', () => {
    expect(parseTemporalFormula('always Safe')).toEqual({
      kind: 'always',
      predicateName: 'Safe',
    });
    expect(parseTemporalFormula('eventually Done')).toEqual({
      kind: 'eventually',
      predicateName: 'Done',
    });
  });

  it('parses quorum operators eventually@q and until@q', () => {
    expect(parseTemporalFormula('eventually@0.6 vote == "yes"')).toEqual({
      kind: 'eventually_quorum',
      threshold: 0.6,
      keySelectorName: 'vote',
      goalKey: 'yes',
    });

    expect(parseTemporalFormula('Hold until@0.75 vote == yes')).toEqual({
      kind: 'until_quorum',
      threshold: 0.75,
      holdPredicateName: 'Hold',
      keySelectorName: 'vote',
      goalKey: 'yes',
    });
  });

  it('parses formula sets with comments and semicolon separators', () => {
    const formulas = parseTemporalFormulaSet(`
      # guard
      always Safe;
      eventually Done // trailing comment
      Hold until Done;
    `);

    expect(formulas).toHaveLength(3);
    expect(formulas.map((formula) => renderTemporalFormula(formula))).toEqual([
      'always Safe',
      'eventually Done',
      'Hold until Done',
    ]);
  });
});

describe('Temporal formula compiler', () => {
  it('compiles until into guard invariant plus eventual goal', () => {
    const formulas = parseTemporalFormulaSet('Hold until Done');
    const compiled = compileTemporalFormulaSet<HoldDoneState>(formulas, {
      predicates: {
        Hold: (state) => state.hold,
        Done: (state) => state.done,
      },
    });

    expect(compiled.requiresSuperposition).toBe(false);
    expect(compiled.invariants).toHaveLength(1);
    expect(compiled.eventual).toHaveLength(1);
    expect(
      compiled.invariants[0]?.test({
        hold: false,
        done: false,
      }),
    ).toBe(false);
  });

  it('compiles eventually@q and auto-enables superposition in merged options', () => {
    const compiled = compileTemporalFormulaText<VoteState>('eventually@0.7 vote == yes', {
      predicates: {},
      keySelectors: {
        vote: (state) => state.vote,
      },
    });

    expect(compiled.requiresSuperposition).toBe(true);
    expect(compiled.eventualQuorum).toHaveLength(1);

    const mergedOptions = mergeCompiledTemporalFormulasIntoCheckerOptions(compiled, {
      maxDepth: 4,
    });

    expect(mergedOptions.superposition?.enabled).toBe(true);
    expect(mergedOptions.maxDepth).toBe(4);
    expect(mergedOptions.eventualQuorum).toHaveLength(1);
  });
});

describe('Temporal formulas with checker integration', () => {
  it('fails until@q when quorum is unreachable', async () => {
    const checker = new ForkRaceFoldModelChecker<VoteState>();
    const compiled = compileTemporalFormulaText<VoteState>('Any until@0.9 vote == yes', {
      predicates: {
        Any: () => true,
      },
      keySelectors: {
        vote: (state) => state.vote,
      },
    });

    const options = mergeCompiledTemporalFormulasIntoCheckerOptions(
      compiled,
      {
        maxDepth: 3,
        superposition: {
          branchAmplitude: (context) =>
            context.successorState.vote === 'yes' ? 2 : 1,
        },
      },
    );

    const result = await checker.check(voteModel, options);

    expect(result.ok).toBe(false);
    expect(result.violations[0]?.kind).toBe('eventual');
    expect(result.violations[0]?.name).toContain('until@0.9');
  });

  it('passes until@q when quorum is reachable', async () => {
    const checker = new ForkRaceFoldModelChecker<VoteState>();
    const compiled = compileTemporalFormulaText<VoteState>('Any until@0.5 vote == yes', {
      predicates: {
        Any: () => true,
      },
      keySelectors: {
        vote: (state) => state.vote,
      },
    });

    const options = mergeCompiledTemporalFormulasIntoCheckerOptions(
      compiled,
      {
        maxDepth: 3,
        superposition: {
          branchAmplitude: (context) =>
            context.successorState.vote === 'yes' ? 2 : 1,
        },
      },
    );

    const result = await checker.check(voteModel, options);

    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
});
