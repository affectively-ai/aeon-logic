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

export interface TraceQuantumMeta {
  readonly amplitude: number;
  readonly phase: 1 | -1;
  readonly probability: number;
}

export interface CheckerSuperpositionBranchContext<State> {
  readonly sourceState: Readonly<State>;
  readonly actionName: string;
  readonly successorState: Readonly<State>;
  readonly successorIndex: number;
}

export interface CheckerTopologyEventFork {
  readonly type: 'fork';
  readonly id: string;
  readonly paths: readonly string[];
}

export interface CheckerTopologyEventRace {
  readonly type: 'race';
  readonly id: string;
  readonly winnerPath: string;
}

export interface CheckerTopologyEventVent {
  readonly type: 'vent';
  readonly id: string;
  readonly path: string;
}

export interface CheckerTopologyEventFold {
  readonly type: 'fold';
  readonly id: string;
}

export interface CheckerTopologyEventObserve {
  readonly type: 'observe';
  readonly id: string;
  readonly strategy?: string;
}

export type CheckerTopologyEvent =
  | CheckerTopologyEventFork
  | CheckerTopologyEventRace
  | CheckerTopologyEventVent
  | CheckerTopologyEventFold
  | CheckerTopologyEventObserve;

export interface CheckerSuperpositionOptions<State> {
  readonly enabled?: boolean;
  readonly keyOfState?: (state: Readonly<State>) => string;
  readonly interfere?: boolean;
  readonly branchAmplitude?: (
    context: CheckerSuperpositionBranchContext<State>,
  ) => number;
  readonly branchPhase?: (
    context: CheckerSuperpositionBranchContext<State>,
  ) => 1 | -1;
  readonly onTopologyEvent?: (event: CheckerTopologyEvent) => void;
}

export interface QuorumEventuallyProperty<State> {
  readonly name: string;
  readonly keyOfState: (state: Readonly<State>) => string;
  readonly threshold: number;
  readonly isGoalKey?: (key: string) => boolean;
  readonly isGoalState?: (state: Readonly<State>) => boolean;
}

export interface CheckerOptions<State> {
  readonly invariants?: readonly NamedPredicate<State>[];
  readonly eventual?: readonly NamedPredicate<State>[];
  readonly eventualQuorum?: readonly QuorumEventuallyProperty<State>[];
  readonly weakFairness?: readonly WeakFairnessRule[];
  readonly superposition?: CheckerSuperpositionOptions<State>;
  readonly maxDepth?: number;
  readonly maxStates?: number;
  readonly concurrency?: number;
}

export interface TraceStep<State> {
  readonly stateId: string;
  readonly state: State;
  readonly viaAction: string | null;
  readonly quantum?: TraceQuantumMeta;
}

export interface Violation<State> {
  readonly kind: 'invariant' | 'eventual';
  readonly name: string;
  readonly message: string;
  readonly trace: readonly TraceStep<State>[];
  readonly cycleStateIds?: readonly string[];
}

/**
 * Topological diagnostics of the exploration graph.
 *
 * The checker IS a discrete Feynman path integral: each BFS layer is a time
 * step, each state is a spatial position, amplitude propagation is the kernel,
 * and folded transitions are interference. These counters make the path-integral
 * structure observable.
 *
 * - forkCount: expansions with >1 successor (β₁ += N-1 each)
 * - foldCount: transitions landing on an already-visited state (interference)
 * - ventCount: unfair cycles filtered by weak fairness (irreversible removal)
 * - beta1: first Betti number of the exploration graph (independent cycles)
 * - depthLayers: number of BFS layers (path-integral time steps)
 * - frontierFill: how rectangular the observed wavefront is over time
 */
export interface CheckerTopologyStats {
  readonly forkCount: number;
  readonly foldCount: number;
  readonly ventCount: number;
  readonly beta1: number;
  readonly depthLayers: number;
  /** Frontier width at each BFS layer. */
  readonly frontierByLayer: readonly number[];
  /** Sum of frontier widths across all layers. */
  readonly frontierArea: number;
  /**
   * frontierArea / (peak frontier width * depthLayers).
   * 1.0 means the observed wavefront stayed maximally full for its own shape.
   */
  readonly frontierFill: number;
  /** Canonical Wallace frontier deficit scalar, measured in Wallys. */
  readonly wallaceNumber: number;
  /** Short-form compatibility alias for the Wallace frontier deficit scalar. */
  readonly wally: number;
  /** Compatibility alias for the Wallace frontier deficit scalar. */
  readonly frontierDeficit: number;
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
  /** Topological diagnostics: the checker as a discrete path integral. */
  readonly topology: CheckerTopologyStats;
}
