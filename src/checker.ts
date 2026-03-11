import type {
  CheckerOptions,
  CheckerResult,
  CheckerStats,
  NamedPredicate,
  TemporalAction,
  TemporalModel,
  Violation,
  WeakFairnessRule,
  TraceStep,
} from './types.js';

interface Edge {
  readonly actionName: string;
  readonly toId: string;
}

interface GraphNode<State> {
  readonly id: string;
  readonly state: State;
  readonly depth: number;
  readonly parentId: string | null;
  readonly viaAction: string | null;
  readonly enabledActions: Set<string>;
  readonly outgoing: Edge[];
}

interface Expansion<State> {
  readonly nodeId: string;
  readonly enabledActions: readonly string[];
  readonly successors: readonly {
    readonly actionName: string;
    readonly state: State;
  }[];
}

const DEFAULT_MAX_DEPTH = 64;
const DEFAULT_MAX_STATES = 200_000;
const DEFAULT_CONCURRENCY = 8;

export class ForkRaceFoldModelChecker<State> {
  async check(
    model: TemporalModel<State>,
    options: CheckerOptions<State> = {},
  ): Promise<CheckerResult<State>> {
    const invariants = options.invariants ?? [];
    const eventual = options.eventual ?? [];
    const weakFairness = options.weakFairness ?? [];
    const maxDepth = Math.max(0, options.maxDepth ?? DEFAULT_MAX_DEPTH);
    const maxStates = Math.max(1, options.maxStates ?? DEFAULT_MAX_STATES);
    const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);

    const nodes = new Map<string, GraphNode<State>>();

    let transitionsExplored = 0;
    let foldedTransitions = 0;
    let maxFrontier = 0;
    let complete = true;

    const initialLayer: string[] = [];

    for (const initialState of model.initialStates) {
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
        );
      }
    }

    let currentLayerIds = initialLayer;

    while (currentLayerIds.length > 0) {
      maxFrontier = Math.max(maxFrontier, currentLayerIds.length);
      const nextLayerIds: string[] = [];

      for (let chunkStart = 0; chunkStart < currentLayerIds.length; chunkStart += concurrency) {
        const chunkIds = currentLayerIds.slice(chunkStart, chunkStart + concurrency);

        const expansions = await Promise.all(
          chunkIds.map(async (nodeId) => {
            const node = nodes.get(nodeId);
            if (!node) {
              throw new Error(`Missing frontier node "${nodeId}"`);
            }
            return this.expandNode(node, model.actions);
          }),
        );

        for (const expansion of expansions) {
          const sourceNode = nodes.get(expansion.nodeId);
          if (!sourceNode) {
            throw new Error(`Missing expansion source "${expansion.nodeId}"`);
          }

          for (const actionName of expansion.enabledActions) {
            sourceNode.enabledActions.add(actionName);
          }

          for (const successor of expansion.successors) {
            transitionsExplored += 1;

            const nextDepth = sourceNode.depth + 1;
            const successorId = model.fingerprint(successor.state);
            const existingNode = nodes.get(successorId);

            if (existingNode) {
              sourceNode.outgoing.push({
                actionName: successor.actionName,
                toId: successorId,
              });
              foldedTransitions += 1;
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
            };

            nodes.set(successorId, createdNode);
            nextLayerIds.push(successorId);

            sourceNode.outgoing.push({
              actionName: successor.actionName,
              toId: successorId,
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
              );
            }
          }
        }
      }

      currentLayerIds = nextLayerIds;

      if (!complete && currentLayerIds.length === 0) {
        break;
      }
    }

    const eventualViolation = complete
      ? this.firstEventuallyViolation(nodes, eventual, weakFairness)
      : null;

    const violations = eventualViolation ? [eventualViolation] : [];

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
    };
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

  private failureResult(
    complete: boolean,
    violations: readonly Violation<State>[],
    statesExplored: number,
    transitionsExplored: number,
    foldedTransitions: number,
    maxFrontier: number,
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
    eventual: readonly NamedPredicate<State>[],
    weakFairness: readonly WeakFairnessRule[],
  ): Violation<State> | null {
    for (const property of eventual) {
      const badStateIds = new Set<string>();

      for (const node of nodes.values()) {
        if (!property.test(node.state)) {
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
            kind: 'eventual',
            name: property.name,
            message: `Eventually property "${property.name}" fails at terminal state ${badStateId}.`,
            trace: this.buildTrace(nodes, badStateId),
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
          continue;
        }

        const cycleEntryState = component[0];
        if (!cycleEntryState) {
          continue;
        }
        return {
          kind: 'eventual',
          name: property.name,
          message: `Eventually property "${property.name}" fails: reachable fair cycle avoids it.`,
          trace: this.buildTrace(nodes, cycleEntryState),
          cycleStateIds: component,
        };
      }
    }

    return null;
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
      });

      cursor = node.parentId;
    }

    return reverseTrace.reverse();
  }

  private expandNode(
    node: GraphNode<State>,
    actions: readonly TemporalAction<State>[],
  ): Expansion<State> {
    const enabledActions: string[] = [];
    const successors: Array<{ actionName: string; state: State }> = [];

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
        successors.push({
          actionName: action.name,
          state: nextState,
        });
      }
    }

    return {
      nodeId: node.id,
      enabledActions,
      successors,
    };
  }
}
