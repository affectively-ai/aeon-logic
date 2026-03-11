import { describe, expect, it } from 'vitest';

import {
  collectTopologyEvents,
  createTopologySamplerBridge,
} from '../src/index.js';

describe('topology bridge', () => {
  it('collects topology events in order', () => {
    const collected = collectTopologyEvents();

    collected.sink({ type: 'fork', id: 'req-1', paths: ['a', 'b'] });
    collected.sink({ type: 'race', id: 'req-1', winnerPath: 'a' });
    collected.sink({ type: 'vent', id: 'req-1', path: 'b' });
    collected.sink({ type: 'fold', id: 'req-1' });

    expect(collected.events).toEqual([
      { type: 'fork', id: 'req-1', paths: ['a', 'b'] },
      { type: 'race', id: 'req-1', winnerPath: 'a' },
      { type: 'vent', id: 'req-1', path: 'b' },
      { type: 'fold', id: 'req-1' },
    ]);
  });

  it('bridges checker topology events into TopologySampler-like API', () => {
    const calls: string[] = [];
    const sampler = {
      fork: (id: string, paths: string[]) => {
        calls.push(`fork:${id}:${paths.join(',')}`);
      },
      race: (id: string, winnerPath: string) => {
        calls.push(`race:${id}:${winnerPath}`);
      },
      vent: (id: string, path: string) => {
        calls.push(`vent:${id}:${path}`);
      },
      fold: (id: string) => {
        calls.push(`fold:${id}`);
      },
    };

    const sink = createTopologySamplerBridge(sampler);
    sink({ type: 'fork', id: 'req-2', paths: ['x', 'y'] });
    sink({ type: 'race', id: 'req-2', winnerPath: 'x' });
    sink({ type: 'vent', id: 'req-2', path: 'y' });
    sink({ type: 'fold', id: 'req-2' });

    expect(calls).toEqual([
      'fork:req-2:x,y',
      'race:req-2:x',
      'vent:req-2:y',
      'fold:req-2',
    ]);
  });
});
