export interface TemporalAction<State> {
  readonly name: string;
  readonly enabled?: (state: Readonly<State>) => boolean;
  readonly successors: (state: Readonly<State>) => readonly State[];
}

export interface TemporalModel<State> {
  readonly initialStates: readonly State[];
  readonly actions: readonly TemporalAction<State>[];
  readonly fingerprint: (state: Readonly<State>) => string;
}

export interface NamedPredicate<State> {
  readonly name: string;
  readonly test: (state: Readonly<State>) => boolean;
}

export interface WeakFairnessRule {
  readonly actionName: string;
}

export interface CheckerOptions<State> {
  readonly invariants?: readonly NamedPredicate<State>[];
  readonly eventual?: readonly NamedPredicate<State>[];
  readonly weakFairness?: readonly WeakFairnessRule[];
  readonly maxDepth?: number;
  readonly maxStates?: number;
  readonly concurrency?: number;
}

export interface TraceStep<State> {
  readonly stateId: string;
  readonly state: State;
  readonly viaAction: string | null;
}

export interface Violation<State> {
  readonly kind: 'invariant' | 'eventual';
  readonly name: string;
  readonly message: string;
  readonly trace: readonly TraceStep<State>[];
  readonly cycleStateIds?: readonly string[];
}

export interface CheckerStats {
  readonly statesExplored: number;
  readonly transitionsExplored: number;
  readonly foldedTransitions: number;
  readonly maxFrontier: number;
}

export interface CheckerResult<State> {
  readonly ok: boolean;
  readonly complete: boolean;
  readonly violations: readonly Violation<State>[];
  readonly stateCount: number;
  readonly stats: CheckerStats;
}
