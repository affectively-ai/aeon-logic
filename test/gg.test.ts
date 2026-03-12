import { describe, expect, it } from 'vitest';
import {
  buildDefaultGgCheckerOptions,
  buildGgTemporalModel,
  checkGgProgram,
  getGgRootNodeIds,
  getGgTerminalNodeIds,
  parseGgProgram,
  ForkRaceFoldModelChecker,
  type GgTopologyState,
} from '../src/index.js';

const forkraceSource = `
// Simple forkrace pipeline
(input: Source { data: '[1, 2, 3]' })
(a: Branch)
(b: Branch)

(input)-[:FORK]->(a | b)-[:RACE]->(winner)
`;

describe('.gg native support', () => {
  it('parses nodes and chained topology edges from .gg source', () => {
    const program = parseGgProgram(forkraceSource);

    expect(program.edges).toHaveLength(2);
    expect(program.edges[0]).toMatchObject({
      sourceIds: ['input'],
      targetIds: ['a', 'b'],
      type: 'FORK',
    });
    expect(program.edges[1]).toMatchObject({
      sourceIds: ['a', 'b'],
      targetIds: ['winner'],
      type: 'RACE',
    });

    const nodeIds = program.nodes.map((node) => node.id);
    expect(nodeIds).toEqual(expect.arrayContaining(['input', 'a', 'b', 'winner']));
  });

  it('derives roots and terminals for topology navigation', () => {
    const program = parseGgProgram(forkraceSource);

    expect(getGgRootNodeIds(program)).toEqual(['input']);
    expect(getGgTerminalNodeIds(program)).toEqual(['winner']);
  });

  it('builds TemporalModel state transitions from .gg topology', async () => {
    const program = parseGgProgram(forkraceSource);
    const model = buildGgTemporalModel(program);
    const checker = new ForkRaceFoldModelChecker<GgTopologyState>();
    const result = await checker.check(
      model,
      buildDefaultGgCheckerOptions(program),
    );

    expect(result.ok).toBe(true);
    expect(result.stateCount).toBeGreaterThan(0);
    expect(result.violations).toHaveLength(0);
  });

  it('checks .gg source directly with default invariants and eventuals', async () => {
    const result = await checkGgProgram(forkraceSource);
    expect(result.ok).toBe(true);
  });

  it('fails when superposition never collapses before terminal states', async () => {
    const noCollapseSource = `
      (start)-[:FORK]->(a | b)
      (a)-[:PROCESS]->(done)
      (b)-[:PROCESS]->(done)
    `;

    const result = await checkGgProgram(noCollapseSource);
    expect(result.ok).toBe(false);
    expect(result.violations[0]?.kind).toBe('eventual');
    expect(result.violations[0]?.name).toBe('eventually_beta1_zero');
  });

  it('rejects .gg source that contains no topology edges', () => {
    expect(() => parseGgProgram('(a: Node { test: \'value\' })')).toThrow(
      'No .gg topology edges were parsed.',
    );
  });
});
