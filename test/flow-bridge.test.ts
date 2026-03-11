import { describe, expect, it } from 'vitest';

import { LogicChainFlowBridge, type FlowForkRaceFoldLike } from '../src/index.js';

class MockFlow implements FlowForkRaceFoldLike {
  private nextId = 1;
  public readonly vents: number[] = [];

  openStream(): number {
    const id = this.nextId;
    this.nextId += 1;
    return id;
  }

  fork(parentStreamId: number, count: number): number[] {
    if (parentStreamId <= 0) {
      throw new Error('parent stream must be positive');
    }
    const ids: number[] = [];
    for (let i = 0; i < count; i += 1) {
      ids.push(this.openStream());
    }
    return ids;
  }

  async race(streamIds: number[]): Promise<{ winner: number; result: Uint8Array }> {
    const winner = streamIds[0];
    if (winner === undefined) {
      throw new Error('race requires at least one stream');
    }
    return {
      winner,
      result: new Uint8Array([winner]),
    };
  }

  async fold(
    streamIds: number[],
    merger: (results: Map<number, Uint8Array>) => Uint8Array,
  ): Promise<Uint8Array> {
    const results = new Map<number, Uint8Array>();
    for (const streamId of streamIds) {
      results.set(streamId, new Uint8Array([streamId]));
    }
    return merger(results);
  }

  vent(streamId: number): void {
    this.vents.push(streamId);
  }
}

describe('LogicChainFlowBridge', () => {
  it('binds root and forks child chains', () => {
    const flow = new MockFlow();
    const bridge = new LogicChainFlowBridge(flow);
    const rootStream = bridge.attachRoot('root');

    const mapping = bridge.forkChains('root', ['a', 'b']);
    expect(rootStream).toBe(1);
    expect(mapping.get('a')).toBeDefined();
    expect(mapping.get('b')).toBeDefined();
    expect(bridge.streamOf('a')).toBe(mapping.get('a'));
  });

  it('races and folds chains by chain ids', async () => {
    const flow = new MockFlow();
    const bridge = new LogicChainFlowBridge(flow);
    bridge.attachRoot('root');
    bridge.forkChains('root', ['a', 'b']);

    const raceResult = await bridge.raceChains(['a', 'b']);
    expect(['a', 'b']).toContain(raceResult.winnerChainId);
    expect(raceResult.result.length).toBe(1);

    const folded = await bridge.foldChains(['a', 'b'], (results) => {
      const merged: number[] = [];
      for (const value of results.values()) {
        merged.push(...value);
      }
      return new Uint8Array(merged.sort((left, right) => left - right));
    });

    expect(folded.length).toBe(2);
  });

  it('vents chains by chain id', () => {
    const flow = new MockFlow();
    const bridge = new LogicChainFlowBridge(flow);
    bridge.attachRoot('root');
    bridge.forkChains('root', ['a']);
    bridge.ventChain('a');

    expect(flow.vents).toHaveLength(1);
    expect(flow.vents[0]).toBe(bridge.streamOf('a'));
  });
});
