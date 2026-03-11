export type ChainPhase = 1 | -1;

export interface LogicChain<State, Step = string> {
  readonly id: string;
  readonly state: State;
  readonly steps: readonly Step[];
  readonly amplitude: number;
  readonly phase: ChainPhase;
  readonly parentId: string | null;
  readonly depth: number;
}

export interface LogicChainCandidate<State, Step = string> {
  readonly id?: string;
  readonly state: State;
  readonly step?: Step;
  readonly relativeAmplitude?: number;
  readonly phase?: ChainPhase;
}

export interface ChainSuperpositionOptions<State> {
  readonly keyOfState?: (state: Readonly<State>) => string;
  readonly epsilon?: number;
}

export interface WeightedLogicChain<State, Step = string> {
  readonly chain: LogicChain<State, Step>;
  readonly probability: number;
}

export interface QuorumMeasurementResult<State, Step = string> {
  readonly satisfied: boolean;
  readonly probability: number;
  readonly chains: readonly LogicChain<State, Step>[];
  readonly winningKey?: string;
}

const DEFAULT_EPSILON = 1e-12;

function toStableKey(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'string') {
    return `string:${value}`;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? `number:${value}` : `number:${JSON.stringify(value)}`;
  }
  if (typeof value === 'boolean') {
    return value ? 'boolean:true' : 'boolean:false';
  }

  try {
    return `json:${JSON.stringify(value)}`;
  } catch {
    return `string:${String(value)}`;
  }
}

function assertFiniteNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative number`);
  }
}

function assertFinitePositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a finite positive number`);
  }
}

function multiplyPhase(left: ChainPhase, right: ChainPhase): ChainPhase {
  return left === right ? 1 : -1;
}

export class LogicChainSuperposition<State, Step = string> {
  private readonly chainsInternal: readonly LogicChain<State, Step>[];
  private readonly keyOfState: (state: Readonly<State>) => string;
  private readonly epsilon: number;

  private constructor(
    chains: readonly LogicChain<State, Step>[],
    options: Required<ChainSuperpositionOptions<State>>,
  ) {
    this.chainsInternal = chains;
    this.keyOfState = options.keyOfState;
    this.epsilon = options.epsilon;
  }

  static seed<State, Step = string>(
    initialState: State,
    options: ChainSuperpositionOptions<State> = {},
  ): LogicChainSuperposition<State, Step> {
    return LogicChainSuperposition.fromChains<State, Step>(
      [
        {
          id: 'root',
          state: initialState,
          steps: [],
          amplitude: 1,
          phase: 1,
          parentId: null,
          depth: 0,
        },
      ],
      options,
    );
  }

  static fromChains<State, Step = string>(
    chains: readonly LogicChain<State, Step>[],
    options: ChainSuperpositionOptions<State> = {},
  ): LogicChainSuperposition<State, Step> {
    const epsilon = options.epsilon ?? DEFAULT_EPSILON;
    assertFinitePositive('epsilon', epsilon);

    const keyOfState = options.keyOfState ?? ((state: Readonly<State>) => toStableKey(state));

    const normalizedChains: LogicChain<State, Step>[] = [];

    for (const chain of chains) {
      if (chain.id.length === 0) {
        throw new Error('Logic chain id must not be empty');
      }
      assertFiniteNonNegative(`chain "${chain.id}" amplitude`, chain.amplitude);
      if (chain.phase !== 1 && chain.phase !== -1) {
        throw new Error(`chain "${chain.id}" phase must be 1 or -1`);
      }
      if (!Number.isInteger(chain.depth) || chain.depth < 0) {
        throw new Error(`chain "${chain.id}" depth must be a non-negative integer`);
      }

      if (chain.amplitude > epsilon) {
        normalizedChains.push(chain);
      }
    }

    normalizedChains.sort((left, right) => left.id.localeCompare(right.id));

    return new LogicChainSuperposition<State, Step>(normalizedChains, {
      keyOfState,
      epsilon,
    });
  }

  get chains(): readonly LogicChain<State, Step>[] {
    return this.chainsInternal;
  }

  fork(
    expand: (
      chain: Readonly<LogicChain<State, Step>>,
    ) => readonly LogicChainCandidate<State, Step>[],
  ): LogicChainSuperposition<State, Step> {
    const nextChains: LogicChain<State, Step>[] = [];

    for (const chain of this.chainsInternal) {
      const candidates = expand(chain);
      if (candidates.length === 0) {
        nextChains.push(chain);
        continue;
      }

      const weights = candidates.map((candidate, index) => {
        const weight = candidate.relativeAmplitude ?? 1;
        assertFinitePositive(
          `candidate relativeAmplitude at chain "${chain.id}" index ${index}`,
          weight,
        );
        return weight;
      });

      let squaredNorm = 0;
      for (const weight of weights) {
        squaredNorm += weight * weight;
      }
      const norm = Math.sqrt(squaredNorm);
      if (!Number.isFinite(norm) || norm <= this.epsilon) {
        continue;
      }

      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        const weight = weights[index];
        if (!candidate || weight === undefined) {
          continue;
        }

        const amplitude = (chain.amplitude * weight) / norm;
        if (amplitude <= this.epsilon) {
          continue;
        }

        const phase = multiplyPhase(chain.phase, candidate.phase ?? 1);
        const id = candidate.id ?? `${chain.id}.${index + 1}`;
        const steps =
          candidate.step === undefined
            ? chain.steps
            : [...chain.steps, candidate.step];

        nextChains.push({
          id,
          state: candidate.state,
          steps,
          amplitude,
          phase,
          parentId: chain.id,
          depth: chain.depth + 1,
        });
      }
    }

    return LogicChainSuperposition.fromChains(nextChains, {
      keyOfState: this.keyOfState,
      epsilon: this.epsilon,
    });
  }

  interfere(
    keyOfState: ((state: Readonly<State>) => string) = this.keyOfState,
  ): LogicChainSuperposition<State, Step> {
    const groups = new Map<string, LogicChain<State, Step>[]>();

    for (const chain of this.chainsInternal) {
      const key = keyOfState(chain.state);
      const existing = groups.get(key);
      if (existing) {
        existing.push(chain);
      } else {
        groups.set(key, [chain]);
      }
    }

    const collapsedChains: LogicChain<State, Step>[] = [];

    for (const group of groups.values()) {
      const representative = group[0];
      if (!representative) {
        continue;
      }

      let signedSum = 0;
      let strongestChain = representative;
      let strongestProbability = representative.amplitude * representative.amplitude;

      for (const chain of group) {
        signedSum += chain.amplitude * chain.phase;

        const probability = chain.amplitude * chain.amplitude;
        if (probability > strongestProbability) {
          strongestProbability = probability;
          strongestChain = chain;
        } else if (probability === strongestProbability && chain.id < strongestChain.id) {
          strongestChain = chain;
        }
      }

      const amplitude = Math.abs(signedSum);
      if (amplitude <= this.epsilon) {
        continue;
      }

      const phase: ChainPhase = signedSum >= 0 ? 1 : -1;
      collapsedChains.push({
        ...strongestChain,
        amplitude,
        phase,
      });
    }

    return LogicChainSuperposition.fromChains(collapsedChains, {
      keyOfState: this.keyOfState,
      epsilon: this.epsilon,
    });
  }

  totalProbability(): number {
    let total = 0;
    for (const chain of this.chainsInternal) {
      total += chain.amplitude * chain.amplitude;
    }
    return total;
  }

  normalize(): LogicChainSuperposition<State, Step> {
    const totalProbability = this.totalProbability();
    if (totalProbability <= this.epsilon) {
      return LogicChainSuperposition.fromChains<State, Step>([], {
        keyOfState: this.keyOfState,
        epsilon: this.epsilon,
      });
    }

    const scale = 1 / Math.sqrt(totalProbability);
    const normalizedChains = this.chainsInternal.map((chain) => ({
      ...chain,
      amplitude: chain.amplitude * scale,
    }));

    return LogicChainSuperposition.fromChains(normalizedChains, {
      keyOfState: this.keyOfState,
      epsilon: this.epsilon,
    });
  }

  distribution(): readonly WeightedLogicChain<State, Step>[] {
    const totalProbability = this.totalProbability();
    if (totalProbability <= this.epsilon) {
      return [];
    }

    const entries = this.chainsInternal.map((chain) => ({
      chain,
      probability: (chain.amplitude * chain.amplitude) / totalProbability,
    }));

    entries.sort(
      (left, right) =>
        right.probability - left.probability ||
        left.chain.id.localeCompare(right.chain.id),
    );

    return entries;
  }

  measureArgmax(): LogicChain<State, Step> | null {
    const distribution = this.distribution();
    const best = distribution[0];
    return best ? best.chain : null;
  }

  measureQuorum(
    keyOfState: (state: Readonly<State>) => string,
    threshold: number,
  ): QuorumMeasurementResult<State, Step> {
    assertFinitePositive('quorum threshold', threshold);
    if (threshold > 1) {
      throw new Error('quorum threshold must be <= 1');
    }

    const grouped = new Map<
      string,
      { probability: number; chains: LogicChain<State, Step>[] }
    >();

    for (const entry of this.distribution()) {
      const key = keyOfState(entry.chain.state);
      const existing = grouped.get(key);
      if (existing) {
        existing.probability += entry.probability;
        existing.chains.push(entry.chain);
      } else {
        grouped.set(key, {
          probability: entry.probability,
          chains: [entry.chain],
        });
      }
    }

    let winnerKey: string | null = null;
    let winnerProbability = 0;
    let winnerChains: readonly LogicChain<State, Step>[] = [];

    for (const [key, value] of grouped) {
      if (
        value.probability > winnerProbability ||
        (value.probability === winnerProbability && (winnerKey === null || key < winnerKey))
      ) {
        winnerKey = key;
        winnerProbability = value.probability;
        winnerChains = value.chains;
      }
    }

    if (winnerKey !== null && winnerProbability >= threshold) {
      return {
        satisfied: true,
        probability: winnerProbability,
        chains: winnerChains,
        winningKey: winnerKey,
      };
    }

    return {
      satisfied: false,
      probability: winnerProbability,
      chains: winnerChains,
    };
  }

  measureMerge<Result>(
    merge: (chains: readonly WeightedLogicChain<State, Step>[]) => Result,
  ): Result {
    return merge(this.distribution());
  }
}
