export interface ComplexNumber {
  readonly re: number;
  readonly im: number;
}

export interface ComplexLogicChain<State, Step = string> {
  readonly id: string;
  readonly state: State;
  readonly steps: readonly Step[];
  readonly coefficient: ComplexNumber;
  readonly parentId: string | null;
  readonly depth: number;
}

export interface ComplexLogicChainCandidate<State, Step = string> {
  readonly id?: string;
  readonly state: State;
  readonly step?: Step;
  readonly relativeCoefficient?: ComplexNumber;
}

export interface ComplexWeightedLogicChain<State, Step = string> {
  readonly chain: ComplexLogicChain<State, Step>;
  readonly probability: number;
}

export interface ComplexChainSuperpositionOptions<State> {
  readonly keyOfState?: (state: Readonly<State>) => string;
  readonly epsilon?: number;
}

export interface ComplexQuorumMeasurementResult<State, Step = string> {
  readonly satisfied: boolean;
  readonly probability: number;
  readonly chains: readonly ComplexLogicChain<State, Step>[];
  readonly winningKey?: string;
}

const DEFAULT_EPSILON = 1e-12;

const ONE_COMPLEX: ComplexNumber = { re: 1, im: 0 };

function complex(re: number, im: number): ComplexNumber {
  return { re, im };
}

function magnitudeSquared(value: ComplexNumber): number {
  return value.re * value.re + value.im * value.im;
}

function addComplex(left: ComplexNumber, right: ComplexNumber): ComplexNumber {
  return complex(left.re + right.re, left.im + right.im);
}

function multiplyComplex(left: ComplexNumber, right: ComplexNumber): ComplexNumber {
  return complex(
    left.re * right.re - left.im * right.im,
    left.re * right.im + left.im * right.re,
  );
}

function scaleComplex(value: ComplexNumber, scalar: number): ComplexNumber {
  return complex(value.re * scalar, value.im * scalar);
}

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}

function assertFiniteComplex(name: string, value: ComplexNumber): void {
  assertFinite(`${name}.re`, value.re);
  assertFinite(`${name}.im`, value.im);
}

function defaultStateKey(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export class ComplexLogicChainSuperposition<State, Step = string> {
  private readonly chainsInternal: readonly ComplexLogicChain<State, Step>[];
  private readonly keyOfState: (state: Readonly<State>) => string;
  private readonly epsilon: number;

  private constructor(
    chains: readonly ComplexLogicChain<State, Step>[],
    options: Required<ComplexChainSuperpositionOptions<State>>,
  ) {
    this.chainsInternal = chains;
    this.keyOfState = options.keyOfState;
    this.epsilon = options.epsilon;
  }

  static seed<State, Step = string>(
    initialState: State,
    options: ComplexChainSuperpositionOptions<State> = {},
  ): ComplexLogicChainSuperposition<State, Step> {
    return ComplexLogicChainSuperposition.fromChains<State, Step>(
      [
        {
          id: 'root',
          state: initialState,
          steps: [],
          coefficient: ONE_COMPLEX,
          parentId: null,
          depth: 0,
        },
      ],
      options,
    );
  }

  static fromChains<State, Step = string>(
    chains: readonly ComplexLogicChain<State, Step>[],
    options: ComplexChainSuperpositionOptions<State> = {},
  ): ComplexLogicChainSuperposition<State, Step> {
    const epsilon = options.epsilon ?? DEFAULT_EPSILON;
    if (!Number.isFinite(epsilon) || epsilon <= 0) {
      throw new Error('epsilon must be a finite positive number');
    }

    const keyOfState = options.keyOfState ?? ((state: Readonly<State>) => defaultStateKey(state));
    const normalized: ComplexLogicChain<State, Step>[] = [];

    for (const chain of chains) {
      if (chain.id.length === 0) {
        throw new Error('Complex logic chain id must not be empty');
      }
      if (!Number.isInteger(chain.depth) || chain.depth < 0) {
        throw new Error(`chain "${chain.id}" depth must be a non-negative integer`);
      }
      assertFiniteComplex(`chain "${chain.id}" coefficient`, chain.coefficient);

      if (magnitudeSquared(chain.coefficient) > epsilon) {
        normalized.push(chain);
      }
    }

    normalized.sort((left, right) => left.id.localeCompare(right.id));

    return new ComplexLogicChainSuperposition<State, Step>(normalized, {
      keyOfState,
      epsilon,
    });
  }

  get chains(): readonly ComplexLogicChain<State, Step>[] {
    return this.chainsInternal;
  }

  fork(
    expand: (
      chain: Readonly<ComplexLogicChain<State, Step>>,
    ) => readonly ComplexLogicChainCandidate<State, Step>[],
  ): ComplexLogicChainSuperposition<State, Step> {
    const nextChains: ComplexLogicChain<State, Step>[] = [];

    for (const chain of this.chainsInternal) {
      const candidates = expand(chain);
      if (candidates.length === 0) {
        nextChains.push(chain);
        continue;
      }

      const relativeCoefficients = candidates.map((candidate, index) => {
        const coefficient = candidate.relativeCoefficient ?? ONE_COMPLEX;
        assertFiniteComplex(
          `candidate relativeCoefficient at chain "${chain.id}" index ${index}`,
          coefficient,
        );
        return coefficient;
      });

      let normSquared = 0;
      for (const coefficient of relativeCoefficients) {
        normSquared += magnitudeSquared(coefficient);
      }
      if (normSquared <= this.epsilon) {
        continue;
      }
      const norm = Math.sqrt(normSquared);

      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        const coefficient = relativeCoefficients[index];
        if (!candidate || !coefficient) {
          continue;
        }

        const normalizedCoefficient = scaleComplex(coefficient, 1 / norm);
        const childCoefficient = multiplyComplex(chain.coefficient, normalizedCoefficient);
        if (magnitudeSquared(childCoefficient) <= this.epsilon) {
          continue;
        }

        nextChains.push({
          id: candidate.id ?? `${chain.id}.${index + 1}`,
          state: candidate.state,
          steps:
            candidate.step === undefined
              ? chain.steps
              : [...chain.steps, candidate.step],
          coefficient: childCoefficient,
          parentId: chain.id,
          depth: chain.depth + 1,
        });
      }
    }

    return ComplexLogicChainSuperposition.fromChains(nextChains, {
      keyOfState: this.keyOfState,
      epsilon: this.epsilon,
    });
  }

  interfere(
    keyOfState: ((state: Readonly<State>) => string) = this.keyOfState,
  ): ComplexLogicChainSuperposition<State, Step> {
    const groups = new Map<string, ComplexLogicChain<State, Step>[]>();

    for (const chain of this.chainsInternal) {
      const key = keyOfState(chain.state);
      const existing = groups.get(key);
      if (existing) {
        existing.push(chain);
      } else {
        groups.set(key, [chain]);
      }
    }

    const collapsed: ComplexLogicChain<State, Step>[] = [];

    for (const group of groups.values()) {
      const representative = group[0];
      if (!representative) {
        continue;
      }

      let sum = complex(0, 0);
      let strongest = representative;
      let strongestProb = magnitudeSquared(representative.coefficient);

      for (const chain of group) {
        sum = addComplex(sum, chain.coefficient);
        const probability = magnitudeSquared(chain.coefficient);
        if (probability > strongestProb) {
          strongest = chain;
          strongestProb = probability;
        } else if (probability === strongestProb && chain.id < strongest.id) {
          strongest = chain;
        }
      }

      if (magnitudeSquared(sum) <= this.epsilon) {
        continue;
      }

      collapsed.push({
        ...strongest,
        coefficient: sum,
      });
    }

    return ComplexLogicChainSuperposition.fromChains(collapsed, {
      keyOfState: this.keyOfState,
      epsilon: this.epsilon,
    });
  }

  totalProbability(): number {
    let total = 0;
    for (const chain of this.chainsInternal) {
      total += magnitudeSquared(chain.coefficient);
    }
    return total;
  }

  normalize(): ComplexLogicChainSuperposition<State, Step> {
    const totalProbability = this.totalProbability();
    if (totalProbability <= this.epsilon) {
      return ComplexLogicChainSuperposition.fromChains([], {
        keyOfState: this.keyOfState,
        epsilon: this.epsilon,
      });
    }

    const scale = 1 / Math.sqrt(totalProbability);
    return ComplexLogicChainSuperposition.fromChains(
      this.chainsInternal.map((chain) => ({
        ...chain,
        coefficient: scaleComplex(chain.coefficient, scale),
      })),
      {
        keyOfState: this.keyOfState,
        epsilon: this.epsilon,
      },
    );
  }

  distribution(): readonly ComplexWeightedLogicChain<State, Step>[] {
    const totalProbability = this.totalProbability();
    if (totalProbability <= this.epsilon) {
      return [];
    }

    const entries = this.chainsInternal.map((chain) => ({
      chain,
      probability: magnitudeSquared(chain.coefficient) / totalProbability,
    }));

    entries.sort(
      (left, right) =>
        right.probability - left.probability ||
        left.chain.id.localeCompare(right.chain.id),
    );

    return entries;
  }

  measureArgmax(): ComplexLogicChain<State, Step> | null {
    const distribution = this.distribution();
    return distribution[0]?.chain ?? null;
  }

  measureQuorum(
    keyOfState: (state: Readonly<State>) => string,
    threshold: number,
  ): ComplexQuorumMeasurementResult<State, Step> {
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
      throw new Error('quorum threshold must be in (0, 1]');
    }

    const grouped = new Map<
      string,
      { probability: number; chains: ComplexLogicChain<State, Step>[] }
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
    let winnerChains: readonly ComplexLogicChain<State, Step>[] = [];

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
    merge: (chains: readonly ComplexWeightedLogicChain<State, Step>[]) => Result,
  ): Result {
    return merge(this.distribution());
  }
}
