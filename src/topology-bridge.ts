import type { CheckerTopologyEvent } from './types.js';

export interface TopologySamplerLike {
  fork(id: string, paths: string[]): void;
  race(id: string, winnerPath: string): void;
  vent(id: string, path: string): void;
  fold(id: string): void;
}

export function createTopologySamplerBridge(
  sampler: TopologySamplerLike,
): (event: CheckerTopologyEvent) => void {
  return (event: CheckerTopologyEvent): void => {
    switch (event.type) {
      case 'fork':
        sampler.fork(event.id, [...event.paths]);
        return;
      case 'race':
        sampler.race(event.id, event.winnerPath);
        return;
      case 'vent':
        sampler.vent(event.id, event.path);
        return;
      case 'fold':
        sampler.fold(event.id);
        return;
      default: {
        const exhaustiveCheck: never = event;
        throw new Error(`Unknown topology event: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  };
}

export function collectTopologyEvents(): {
  readonly events: CheckerTopologyEvent[];
  readonly sink: (event: CheckerTopologyEvent) => void;
} {
  const events: CheckerTopologyEvent[] = [];
  return {
    events,
    sink: (event: CheckerTopologyEvent): void => {
      events.push(event);
    },
  };
}
