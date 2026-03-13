import { LogicChainSuperposition } from './superposition.js';
import type {
  CheckerOptions,
  CheckerResult,
  CheckerStats,
  CheckerSuperpositionOptions,
  CheckerTopologyStats,
  NamedPredicate,
  QuorumEventuallyProperty,
  TemporalAction,
  TemporalModel,
  TraceStep,
  Violation,
  WeakFairnessRule,
} from './types.js';

interface Edge {
  readonly actionName: string;
  readonly toId: string;
  readonly probability: number;
  readonly amplitude: number;
  readonly phase: 1 | -1;
}

interface GraphNode<State> {
  readonly id: string;
  readonly state: State;
  readonly depth: number;
  readonly parentId: string | null;
  readonly viaAction: string | null;
  readonly enabledActions: Set<string>;
  readonly outgoing: Edge[];
  readonly quorumSatisfied: Set<string>;
  amplitude: number;
  phase: 1 | -1;
  probability: number;
}

interface ExpandedSuccessor<State> {
  readonly actionName: string;
  readonly state: State;
  readonly pathId: string;
  readonly amplitude: number;
  readonly phase: 1 | -1;
  readonly probability: number;
}

interface Expansion<State> {
  readonly nodeId: string;
  readonly enabledActions: readonly string[];
  readonly successors: readonly ExpandedSuccessor<State>[];
  readonly quorumSatisfied: readonly string[];
}

interface RawSuccessor<State> {
  readonly actionName: string;
  readonly state: State;
  readonly successorIndex: number;
  readonly pathId: string;
}

interface NodeEventuallyProperty<State> {
  readonly name: string;
  readonly test: (node: Readonly<GraphNode<State>>) => boolean;
}

const DEFAULT_MAX_DEPTH = 64;
const DEFAULT_MAX_STATES = 200_000;
const DEFAULT_CONCURRENCY = 8;
const QUANTUM_EPSILON = 1e-12;

function multiplyPhase(left: 1 | -1, right: 1 | -1): 1 | -1 {
  return left === right ? 1 : -1;
}

function defaultStateKey(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export class ForkRaceFoldModelChecker<State> {
  async check(
    model: TemporalModel<State>,
    options: CheckerOptions<State> = {},
  ): Promise<CheckerResult<State>> {
    const invariants = options.invariants ?? [];
    const eventual = options.eventual ?? [];
    const eventualQuorum = options.eventualQuorum ?? [];
    const weakFairness = options.weakFairness ?? [];
    const maxDepth = Math.max(0, options.maxDepth ?? DEFAULT_MAX_DEPTH);
    const maxStates = Math.max(1, options.maxStates ?? DEFAULT_MAX_STATES);
    const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
    const superposition = this.resolveSuperposition(options.superposition);
    const superpositionEnabled = Boolean(superposition);

    const nodes = new Map<string, GraphNode<State>>();

    let transitionsExplored = 0;
    let foldedTransitions = 0;
    let maxFrontier = 0;
    let complete = true;
    let forkCount = 0;
    let ventCount = 0;
    let depthLayers = 0;
    const frontierByLayer: number[] = [];

    const initialLayer: string[] = [];
    const dedupedInitialStates: State[] = [];
    const seenInitialIds = new Set<string>();

    for (const initialState of model.initialStates) {
      const stateId = model.fingerprint(initialState);
      if (seenInitialIds.has(stateId)) {
        continue;
      }
      seenInitialIds.add(stateId);
      dedupedInitialStates.push(initialState);
    }

    const initialAmplitude = superpositionEnabled
      ? 1 / Math.sqrt(Math.max(1, dedupedInitialStates.length))
      : 1;

    for (const initialState of dedupedInitialStates) {
      const stateId = model.fingerprint(initialState);
      if (nodes.has(stateId)) {
        continue;
      }

      if (nodes.size >= maxStates) {
        complete = false;
        break;
      }

      const node: GraphNode<State> = {
        id: stateId,
        state: initialState,
        depth: 0,
        parentId: null,
        viaAction: null,
        enabledActions: new Set<string>(),
        outgoing: [],
        quorumSatisfied: new Set<string>(),
        amplitude: initialAmplitude,
        phase: 1,
        probability: initialAmplitude * initialAmplitude,
      };

      nodes.set(stateId, node);
      initialLayer.push(stateId);

      const invariantViolation = this.firstInvariantViolation(node, invariants, nodes);
      if (invariantViolation) {
        return this.failureResult(
          complete,
          [invariantViolation],
          nodes.size,
          transitionsExplored,
          foldedTransitions,
          maxFrontier,
          forkCount,
          ventCount,
          frontierByLayer,
        );
      }
    }

    let currentLayerIds = initialLayer;

    while (currentLayerIds.length > 0) {
      maxFrontier = Math.max(maxFrontier, currentLayerIds.length);
      frontierByLayer.push(currentLayerIds.length);
      const nextLayerIds: string[] = [];

      for (let chunkStart = 0; chunkStart < currentLayerIds.length; chunkStart += concurrency) {
        const chunkIds = currentLayerIds.slice(chunkStart, chunkStart + concurrency);

        const expansions = await Promise.all(
          chunkIds.map(async (nodeId) => {
            const node = nodes.get(nodeId);
            if (!node) {
              throw new Error(`Missing frontier node "${nodeId}"`);
            }
            return this.expandNode(
              node,
              model.actions,
              superposition,
              eventualQuorum,
            );
          }),
        );

        for (const expansion of expansions) {
          const sourceNode = nodes.get(expansion.nodeId);
          if (!sourceNode) {
            throw new Error(`Missing expansion source "${expansion.nodeId}"`);
          }

          if (expansion.successors.length > 1) {
            forkCount += 1;
          }

          for (const actionName of expansion.enabledActions) {
            sourceNode.enabledActions.add(actionName);
          }

          for (const quorumPropertyName of expansion.quorumSatisfied) {
            sourceNode.quorumSatisfied.add(quorumPropertyName);
          }

          for (const successor of expansion.successors) {
            transitionsExplored += 1;

            const nextDepth = sourceNode.depth + 1;
            const successorId = model.fingerprint(successor.state);
            const existingNode = nodes.get(successorId);
            const incomingAmplitude = sourceNode.amplitude * successor.amplitude;
            const incomingPhase = multiplyPhase(sourceNode.phase, successor.phase);
            const incomingProbability = incomingAmplitude * incomingAmplitude;

            if (existingNode) {
              sourceNode.outgoing.push({
                actionName: successor.actionName,
                toId: successorId,
                probability: incomingProbability,
                amplitude: incomingAmplitude,
                phase: incomingPhase,
              });
              foldedTransitions += 1;

              if (superpositionEnabled) {
                const existingSigned = existingNode.amplitude * existingNode.phase;
                const incomingSigned = incomingAmplitude * incomingPhase;
                const combinedSigned = existingSigned + incomingSigned;
                existingNode.amplitude = Math.abs(combinedSigned);
                existingNode.phase = combinedSigned >= 0 ? 1 : -1;
                existingNode.probability = existingNode.amplitude * existingNode.amplitude;
              }
              continue;
            }

            if (nextDepth > maxDepth) {
              complete = false;
              continue;
            }

            if (nodes.size >= maxStates) {
              complete = false;
              continue;
            }

            const createdNode: GraphNode<State> = {
              id: successorId,
              state: successor.state,
              depth: nextDepth,
              parentId: sourceNode.id,
              viaAction: successor.actionName,
              enabledActions: new Set<string>(),
              outgoing: [],
              quorumSatisfied: new Set<string>(),
              amplitude: incomingAmplitude,
              phase: incomingPhase,
              probability: incomingProbability,
            };

            nodes.set(successorId, createdNode);
            nextLayerIds.push(successorId);

            sourceNode.outgoing.push({
              actionName: successor.actionName,
              toId: successorId,
              probability: incomingProbability,
              amplitude: incomingAmplitude,
              phase: incomingPhase,
            });

            const invariantViolation = this.firstInvariantViolation(
              createdNode,
              invariants,
              nodes,
            );

            if (invariantViolation) {
              return this.failureResult(
                complete,
                [invariantViolation],
                nodes.size,
                transitionsExplored,
                foldedTransitions,
                maxFrontier,
                forkCount,
                ventCount,
                frontierByLayer,
              );
            }
          }
        }
      }

      depthLayers += 1;
      currentLayerIds = nextLayerIds;

      if (!complete && currentLayerIds.length === 0) {
        break;
      }
    }

    const eventualProperties = this.buildNodeEventuallyProperties(
      eventual,
      eventualQuorum,
    );

    const eventualResult = complete
      ? this.firstEventuallyViolation(nodes, eventualProperties, weakFairness)
      : null;

    if (eventualResult) {
      ventCount += eventualResult.ventCount;
    }

    const violations = eventualResult?.violation ? [eventualResult.violation] : [];

    return {
      ok: violations.length === 0,
      complete,
      violations,
      stateCount: nodes.size,
      stats: this.buildStats(
        nodes.size,
        transitionsExplored,
        foldedTransitions,
        maxFrontier,
      ),
      topology: this.buildTopology(
        forkCount,
        foldedTransitions,
        ventCount,
        frontierByLayer,
        nodes.size,
        transitionsExplored,
      ),
    };
  }

  private resolveSuperposition(
    options: CheckerSuperpositionOptions<State> | undefined,
  ): CheckerSuperpositionOptions<State> | null {
    if (!options) {
      return null;
    }
    if (options.enabled === false) {
      return null;
    }
    return options;
  }

  private buildNodeEventuallyProperties(
    eventual: readonly NamedPredicate<State>[],
    eventualQuorum: readonly QuorumEventuallyProperty<State>[],
  ): readonly NodeEventuallyProperty<State>[] {
    const statePredicates: NodeEventuallyProperty<State>[] = eventual.map((property) => ({
      name: property.name,
      test: (node) => property.test(node.state),
    }));

    const quorumPredicates: NodeEventuallyProperty<State>[] = eventualQuorum.map((property) => ({
      name: property.name,
      test: (node) => node.quorumSatisfied.has(property.name),
    }));

    return [...statePredicates, ...quorumPredicates];
  }

  private buildStats(
    statesExplored: number,
    transitionsExplored: number,
    foldedTransitions: number,
    maxFrontier: number,
  ): CheckerStats {
    return {
      statesExplored,
      transitionsExplored,
      foldedTransitions,
      maxFrontier,
    };
  }

  private buildTopology(
    forkCount: number,
    foldedTransitions: number,
    ventCount: number,
    frontierByLayer: readonly number[],
    statesExplored: number,
    transitionsExplored: number,
  ): CheckerTopologyStats {
    // β₁ = edges - nodes + connected components
    // For a connected BFS graph, components = 1
    const beta1 = Math.max(0, transitionsExplored - statesExplored + 1);
    const frontierArea = frontierByLayer.reduce((sum, width) => sum + width, 0);
    const peakFrontier = frontierByLayer.reduce(
      (peak, width) => Math.max(peak, width),
      0,
    );
    const depthLayers = frontierByLayer.length;
    const envelopeArea = peakFrontier * depthLayers;
    const frontierFill = envelopeArea === 0 ? 1 : frontierArea / envelopeArea;
    const wallaceNumber = 1 - frontierFill;
    return {
      forkCount,
      foldCount: foldedTransitions,
      ventCount,
      beta1,
      depthLayers,
      frontierByLayer: [...frontierByLayer],
      frontierArea,
      frontierFill,
      wallaceNumber,
      wally: wallaceNumber,
      frontierDeficit: wallaceNumber,
    };
  }

  private failureResult(
    complete: boolean,
    violations: readonly Violation<State>[],
    statesExplored: number,
    transitionsExplored: number,
    foldedTransitions: number,
    maxFrontier: number,
    forkCount: number,
    ventCount: number,
    frontierByLayer: readonly number[],
  ): CheckerResult<State> {
    return {
      ok: false,
      complete,
      violations,
      stateCount: statesExplored,
      stats: this.buildStats(
        statesExplored,
        transitionsExplored,
        foldedTransitions,
        maxFrontier,
      ),
      topology: this.buildTopology(
        forkCount,
        foldedTransitions,
        ventCount,
        frontierByLayer,
        statesExplored,
        transitionsExplored,
      ),
    };
  }

  private firstInvariantViolation(
    node: GraphNode<State>,
    invariants: readonly NamedPredicate<State>[],
    nodes: Map<string, GraphNode<State>>,
  ): Violation<State> | null {
    for (const invariant of invariants) {
      if (invariant.test(node.state)) {
        continue;
      }

      return {
        kind: 'invariant',
        name: invariant.name,
        message: `Invariant "${invariant.name}" violated at state ${node.id}.`,
        trace: this.buildTrace(nodes, node.id),
      };
    }

    return null;
  }

  private firstEventuallyViolation(
    nodes: Map<string, GraphNode<State>>,
    eventual: readonly NodeEventuallyProperty<State>[],
    weakFairness: readonly WeakFairnessRule[],
  ): { violation: Violation<State> | null; ventCount: number } {
    let ventCount = 0;

    for (const property of eventual) {
      const badStateIds = new Set<string>();

      for (const node of nodes.values()) {
        if (!property.test(node)) {
          badStateIds.add(node.id);
        }
      }

      if (badStateIds.size === 0) {
        continue;
      }

      for (const badStateId of badStateIds) {
        const node = nodes.get(badStateId);
        if (!node) {
          continue;
        }

        if (node.outgoing.length === 0) {
          return {
            violation: {
              kind: 'eventual',
              name: property.name,
              message: `Eventually property "${property.name}" fails at terminal state ${badStateId}.`,
              trace: this.buildTrace(nodes, badStateId),
            },
            ventCount,
          };
        }
      }

      const badAdjacency = new Map<string, string[]>();

      for (const badStateId of badStateIds) {
        badAdjacency.set(badStateId, []);
      }

      for (const badStateId of badStateIds) {
        const node = nodes.get(badStateId);
        if (!node) {
          continue;
        }

        const badNeighbors = node.outgoing
          .map((edge) => edge.toId)
          .filter((toId) => badStateIds.has(toId));
        badAdjacency.set(badStateId, badNeighbors);
      }

      const components = this.stronglyConnectedComponents([...badStateIds], badAdjacency);

      for (const component of components) {
        if (!this.hasCycle(component, badAdjacency)) {
          continue;
        }

        if (!this.isFairCycle(component, nodes, weakFairness)) {
          ventCount += 1;
          continue;
        }

        const cycleEntryState = component[0];
        if (!cycleEntryState) {
          continue;
        }
        return {
          violation: {
            kind: 'eventual',
            name: property.name,
            message: `Eventually property "${property.name}" fails: reachable fair cycle avoids it.`,
            trace: this.buildTrace(nodes, cycleEntryState),
            cycleStateIds: component,
          },
          ventCount,
        };
      }
    }

    return { violation: null, ventCount };
  }

  private isFairCycle(
    cycleStateIds: readonly string[],
    nodes: Map<string, GraphNode<State>>,
    weakFairness: readonly WeakFairnessRule[],
  ): boolean {
    if (weakFairness.length === 0) {
      return true;
    }

    const cycleSet = new Set(cycleStateIds);
    const cycleActions = new Set<string>();

    for (const stateId of cycleStateIds) {
      const node = nodes.get(stateId);
      if (!node) {
        continue;
      }

      for (const edge of node.outgoing) {
        if (cycleSet.has(edge.toId)) {
          cycleActions.add(edge.actionName);
        }
      }
    }

    for (const fairnessRule of weakFairness) {
      if (cycleActions.has(fairnessRule.actionName)) {
        continue;
      }

      const enabledEverywhere = cycleStateIds.every((stateId) => {
        const node = nodes.get(stateId);
        return Boolean(node && node.enabledActions.has(fairnessRule.actionName));
      });

      if (enabledEverywhere) {
        return false;
      }
    }

    return true;
  }

  private hasCycle(
    componentStateIds: readonly string[],
    adjacency: Map<string, string[]>,
  ): boolean {
    if (componentStateIds.length > 1) {
      return true;
    }

    const onlyStateId = componentStateIds[0];
    if (!onlyStateId) {
      return false;
    }
    const neighbors = adjacency.get(onlyStateId) ?? [];
    return neighbors.includes(onlyStateId);
  }

  private stronglyConnectedComponents(
    nodeIds: readonly string[],
    adjacency: Map<string, string[]>,
  ): string[][] {
    const indexByNode = new Map<string, number>();
    const lowlinkByNode = new Map<string, number>();
    const nodeStack: string[] = [];
    const inStack = new Set<string>();
    const components: string[][] = [];
    let currentIndex = 0;

    const strongConnect = (nodeId: string): void => {
      indexByNode.set(nodeId, currentIndex);
      lowlinkByNode.set(nodeId, currentIndex);
      currentIndex += 1;
      nodeStack.push(nodeId);
      inStack.add(nodeId);

      const neighbors = adjacency.get(nodeId) ?? [];

      for (const neighborId of neighbors) {
        if (!indexByNode.has(neighborId)) {
          strongConnect(neighborId);

          const nodeLowlink = lowlinkByNode.get(nodeId);
          const neighborLowlink = lowlinkByNode.get(neighborId);
          if (nodeLowlink === undefined || neighborLowlink === undefined) {
            throw new Error('Tarjan lowlink bookkeeping failed');
          }

          lowlinkByNode.set(nodeId, Math.min(nodeLowlink, neighborLowlink));
          continue;
        }

        if (!inStack.has(neighborId)) {
          continue;
        }

        const nodeLowlink = lowlinkByNode.get(nodeId);
        const neighborIndex = indexByNode.get(neighborId);
        if (nodeLowlink === undefined || neighborIndex === undefined) {
          throw new Error('Tarjan stack bookkeeping failed');
        }

        lowlinkByNode.set(nodeId, Math.min(nodeLowlink, neighborIndex));
      }

      const nodeIndex = indexByNode.get(nodeId);
      const nodeLowlink = lowlinkByNode.get(nodeId);

      if (nodeIndex === undefined || nodeLowlink === undefined) {
        throw new Error('Tarjan node state missing');
      }

      if (nodeLowlink !== nodeIndex) {
        return;
      }

      const component: string[] = [];

      while (nodeStack.length > 0) {
        const poppedNode = nodeStack.pop();
        if (poppedNode === undefined) {
          break;
        }

        inStack.delete(poppedNode);
        component.push(poppedNode);

        if (poppedNode === nodeId) {
          break;
        }
      }

      components.push(component);
    };

    for (const nodeId of nodeIds) {
      if (!indexByNode.has(nodeId)) {
        strongConnect(nodeId);
      }
    }

    return components;
  }

  private buildTrace(
    nodes: Map<string, GraphNode<State>>,
    endStateId: string,
  ): TraceStep<State>[] {
    const reverseTrace: TraceStep<State>[] = [];
    let cursor: string | null = endStateId;

    while (cursor !== null) {
      const node = nodes.get(cursor);
      if (!node) {
        break;
      }

      reverseTrace.push({
        stateId: node.id,
        state: node.state,
        viaAction: node.viaAction,
        quantum: {
          amplitude: node.amplitude,
          phase: node.phase,
          probability: node.probability,
        },
      });

      cursor = node.parentId;
    }

    return reverseTrace.reverse();
  }

  private expandNode(
    node: GraphNode<State>,
    actions: readonly TemporalAction<State>[],
    superposition: CheckerSuperpositionOptions<State> | null,
    eventualQuorum: readonly QuorumEventuallyProperty<State>[],
  ): Expansion<State> {
    const enabledActions: string[] = [];
    const rawSuccessors: RawSuccessor<State>[] = [];
    let successorIndex = 0;

    for (const action of actions) {
      const enabled = action.enabled ? action.enabled(node.state) : true;
      if (!enabled) {
        continue;
      }

      const nextStates = action.successors(node.state);
      if (nextStates.length === 0) {
        continue;
      }

      enabledActions.push(action.name);

      for (const nextState of nextStates) {
        rawSuccessors.push({
          actionName: action.name,
          state: nextState,
          successorIndex,
          pathId: `${action.name}:${successorIndex}`,
        });
        successorIndex += 1;
      }
    }

    if (!superposition) {
      return {
        nodeId: node.id,
        enabledActions,
        successors: rawSuccessors.map((successor) => ({
          actionName: successor.actionName,
          state: successor.state,
          pathId: successor.pathId,
          amplitude: 1,
          phase: 1,
          probability: 1,
        })),
        quorumSatisfied: [],
      };
    }

    const keyOfState = superposition.keyOfState ?? defaultStateKey;
    const branchById = new Map<string, RawSuccessor<State>>();

    const forked = LogicChainSuperposition.seed(node.state, { keyOfState }).fork(() =>
      rawSuccessors.map((successor) => {
        branchById.set(successor.pathId, successor);
        const context = {
          sourceState: node.state,
          actionName: successor.actionName,
          successorState: successor.state,
          successorIndex: successor.successorIndex,
        };

        return {
          id: successor.pathId,
          state: successor.state,
          step: successor.actionName,
          relativeAmplitude: superposition.branchAmplitude
            ? superposition.branchAmplitude(context)
            : 1,
          phase: superposition.branchPhase
            ? superposition.branchPhase(context)
            : 1,
        };
      }),
    );

    const interfered =
      superposition.interfere === false
        ? forked
        : forked.interfere(keyOfState);

    const distribution = interfered.distribution();

    const resolvedSuccessors: ExpandedSuccessor<State>[] = distribution
      .map((entry) => {
        const raw = branchById.get(entry.chain.id);
        if (!raw) {
          return null;
        }
        return {
          actionName: raw.actionName,
          state: raw.state,
          pathId: raw.pathId,
          amplitude: Math.sqrt(entry.probability),
          phase: entry.chain.phase,
          probability: entry.probability,
        };
      })
      .filter((entry): entry is ExpandedSuccessor<State> => entry !== null)
      .sort(
        (left, right) =>
          right.probability - left.probability ||
          left.pathId.localeCompare(right.pathId),
      );

    this.emitTopologyEvents(
      node,
      rawSuccessors,
      resolvedSuccessors,
      superposition,
    );

    const quorumSatisfied = this.evaluateQuorumProperties(
      interfered,
      eventualQuorum,
    );

    return {
      nodeId: node.id,
      enabledActions,
      successors: resolvedSuccessors,
      quorumSatisfied,
    };
  }

  private emitTopologyEvents(
    node: Readonly<GraphNode<State>>,
    rawSuccessors: readonly RawSuccessor<State>[],
    resolvedSuccessors: readonly ExpandedSuccessor<State>[],
    superposition: CheckerSuperpositionOptions<State>,
  ): void {
    const sink = superposition.onTopologyEvent;
    if (!sink || rawSuccessors.length < 2) {
      return;
    }

    const requestId = `${node.id}@${node.depth + 1}`;
    const paths = rawSuccessors.map((successor) => successor.pathId);
    sink({ type: 'fork', id: requestId, paths });

    const winner = resolvedSuccessors[0];
    if (winner) {
      sink({
        type: 'race',
        id: requestId,
        winnerPath: winner.pathId,
      });
    }

    const survivingPaths = new Set(resolvedSuccessors.map((successor) => successor.pathId));
    for (const path of paths) {
      if (!survivingPaths.has(path)) {
        sink({
          type: 'vent',
          id: requestId,
          path,
        });
      }
    }

    sink({ type: 'fold', id: requestId });
  }

  private evaluateQuorumProperties(
    superposition: LogicChainSuperposition<State, string>,
    eventualQuorum: readonly QuorumEventuallyProperty<State>[],
  ): readonly string[] {
    if (eventualQuorum.length === 0) {
      return [];
    }

    const satisfied: string[] = [];

    for (const property of eventualQuorum) {
      const result = superposition.measureQuorum(
        property.keyOfState,
        property.threshold,
      );
      if (!result.satisfied) {
        continue;
      }

      let goalSatisfied = true;
      let goalChains = result.chains;

      if (property.isGoalKey) {
        const goalKeyResult = superposition.measureQuorum(
          (state) => (property.isGoalKey?.(property.keyOfState(state)) ? '__goal__' : '__other__'),
          property.threshold,
        );

        goalSatisfied =
          goalSatisfied &&
          goalKeyResult.satisfied &&
          goalKeyResult.winningKey === '__goal__';

        if (goalSatisfied) {
          goalChains = goalKeyResult.chains;
        }
      }

      if (property.isGoalState) {
        goalSatisfied =
          goalSatisfied &&
          goalChains.some((chain) => property.isGoalState?.(chain.state) === true);
      }

      if (goalSatisfied) {
        satisfied.push(property.name);
      }
    }

    return satisfied;
  }
}
