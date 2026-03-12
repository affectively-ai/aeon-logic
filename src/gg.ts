import { ForkRaceFoldModelChecker } from './checker.js';
import type { CheckerOptions, CheckerResult, TemporalModel } from './types.js';

export interface GgNode {
  readonly id: string;
  readonly labels: readonly string[];
  readonly properties: Readonly<Record<string, string>>;
}

export interface GgEdge {
  readonly sourceIds: readonly string[];
  readonly targetIds: readonly string[];
  readonly type: string;
  readonly properties: Readonly<Record<string, string>>;
}

export interface GgProgram {
  readonly nodes: readonly GgNode[];
  readonly edges: readonly GgEdge[];
}

/**
 * Collapse strategies for CRDT merge semantics.
 * Declared on COLLAPSE/FOLD edges via the `strategy` property.
 * The topology IS the state — CRDT is the only state model.
 */
export type GgCollapseStrategy =
  | 'lww'              // Last-Writer-Wins by hybrid logical clock
  | 'ot-transform'     // Operational transformation on positions
  | 'fold-sum'         // Commutative addition (counters)
  | 'observe-remove'   // Only remove what the observer has seen (sets)
  | 'per-key'          // Independent collapse per map key
  | 'causal-order'     // Lamport timestamp ordering (event logs)
  | 'all-pass'         // All branches must succeed (test verdicts)
  | 'majority'         // Majority vote
  | 'weighted';        // Weighted combination

export interface GgTopologyState {
  readonly nodeId: string;
  readonly beta1: number;
}

export interface GgTemporalModelOptions {
  readonly initialNodeId?: string;
  readonly initialBeta1?: number;
  readonly actionName?: string;
}

export interface GgCheckerDefaults {
  readonly maxDepth?: number;
  readonly maxBeta1Exclusive?: number;
}

const DEFAULT_GG_ACTION = 'gg-step';
const DEFAULT_MAX_BETA1_EXCLUSIVE = 10;
const DEFAULT_MAX_DEPTH = 32;

function stripCommentsAndEmptyLines(sourceText: string): string {
  return sourceText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('//'))
    .join('\n');
}

function splitPipe(raw: string): string[] {
  return raw
    .split('|')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function parseProperties(propertiesRaw: string | undefined): Record<string, string> {
  if (!propertiesRaw) {
    return {};
  }

  const properties: Record<string, string> = {};
  const pairs = propertiesRaw.match(/(\w+)\s*:\s*('[^']*'|"[^"]*"|\[[^\]]*\]|[^,]+)/g);
  if (!pairs) {
    return properties;
  }

  for (const pair of pairs) {
    const separator = pair.indexOf(':');
    if (separator < 0) {
      continue;
    }
    const key = pair.slice(0, separator).trim();
    const value = pair
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (key.length > 0 && value.length > 0) {
      properties[key] = value;
    }
  }

  return properties;
}

function upsertNode(
  nodes: Map<string, GgNode>,
  nodeId: string,
  label: string | undefined,
  properties: Readonly<Record<string, string>>,
): void {
  const existing = nodes.get(nodeId);
  if (!existing) {
    nodes.set(nodeId, {
      id: nodeId,
      labels: label ? [label] : [],
      properties,
    });
    return;
  }

  const labels = new Set(existing.labels);
  if (label && label.length > 0) {
    labels.add(label);
  }

  nodes.set(nodeId, {
    id: nodeId,
    labels: [...labels],
    properties: {
      ...existing.properties,
      ...properties,
    },
  });
}

export function parseGgProgram(sourceText: string): GgProgram {
  const cleanedInput = stripCommentsAndEmptyLines(sourceText);
  const nodes = new Map<string, GgNode>();
  const edges: GgEdge[] = [];

  const nodeRegex = /\(([^:)\s]+)(?:\s*:\s*([^{\s)]+))?(?:\s*{([^}]+)})?\)/g;
  let nodeMatch: RegExpExecArray | null;

  while ((nodeMatch = nodeRegex.exec(cleanedInput)) !== null) {
    const nodeId = (nodeMatch[1] ?? '').trim();
    if (nodeId.length === 0 || nodeId.includes('|')) {
      continue;
    }
    const label = nodeMatch[2]?.trim();
    const properties = parseProperties(nodeMatch[3]?.trim());
    upsertNode(nodes, nodeId, label, properties);
  }

  const edgeRegex = /\(([^)]+)\)\s*-\[:([A-Z]+)(?:\s*{([^}]+)})?\]->\s*\(([^)]+)\)/g;
  let edgeMatch: RegExpExecArray | null;

  while ((edgeMatch = edgeRegex.exec(cleanedInput)) !== null) {
    const sourceRaw = (edgeMatch[1] ?? '').trim();
    const type = (edgeMatch[2] ?? '').trim();
    const targetRaw = (edgeMatch[4] ?? '').trim();
    const properties = parseProperties(edgeMatch[3]?.trim());
    const sourceIds = splitPipe(sourceRaw);
    const targetIds = splitPipe(targetRaw);

    edges.push({
      sourceIds,
      targetIds,
      type,
      properties,
    });

    // Support chained edges by rewinding cursor to the start of target.
    const matched = edgeMatch[0];
    const targetSegment = `(${edgeMatch[4]})`;
    const targetOffset = matched.lastIndexOf(targetSegment);
    edgeRegex.lastIndex = edgeMatch.index + targetOffset;

    for (const sourceId of sourceIds) {
      if (!nodes.has(sourceId)) {
        upsertNode(nodes, sourceId, undefined, {});
      }
    }
    for (const targetId of targetIds) {
      if (!nodes.has(targetId)) {
        upsertNode(nodes, targetId, undefined, {});
      }
    }
  }

  if (edges.length === 0) {
    throw new Error('No .gg topology edges were parsed.');
  }

  return {
    nodes: [...nodes.values()],
    edges,
  };
}

export function getGgRootNodeIds(program: GgProgram): readonly string[] {
  const allTargets = new Set(program.edges.flatMap((edge) => edge.targetIds));
  const allSources = new Set(program.edges.flatMap((edge) => edge.sourceIds));
  return [...allSources].filter((sourceId) => !allTargets.has(sourceId));
}

export function getGgTerminalNodeIds(program: GgProgram): readonly string[] {
  const allTargets = new Set(program.edges.flatMap((edge) => edge.targetIds));
  const allSources = new Set(program.edges.flatMap((edge) => edge.sourceIds));
  return [...allTargets].filter((targetId) => !allSources.has(targetId));
}

export function buildGgTemporalModel(
  program: GgProgram,
  options: GgTemporalModelOptions = {},
): TemporalModel<GgTopologyState> {
  const roots = getGgRootNodeIds(program);
  const fallbackInitialNode = program.edges[0]?.sourceIds[0];
  const initialNodeId = options.initialNodeId ?? roots[0] ?? fallbackInitialNode ?? 'root';
  const initialBeta1 = options.initialBeta1 ?? 0;
  const actionName = options.actionName ?? DEFAULT_GG_ACTION;

  return {
    initialStates: [{ nodeId: initialNodeId, beta1: initialBeta1 }],
    fingerprint: (state) => `${state.nodeId}:${state.beta1}`,
    actions: [
      {
        name: actionName,
        successors: (state) => {
          const outgoing = program.edges.filter((edge) =>
            edge.sourceIds.includes(state.nodeId),
          );

          return outgoing.flatMap((edge) => {
            // β₁ transition table — the topology IS the state
            // CRDT is the only state model. No memory. No GC. Append-only.
            const nextBeta1 =
              edge.type === 'FORK'
                ? state.beta1 + (edge.targetIds.length - 1)
                : edge.type === 'FOLD' || edge.type === 'COLLAPSE' || edge.type === 'OBSERVE'
                  ? 0
                  : edge.type === 'RACE'
                    ? Math.max(0, state.beta1 - (edge.sourceIds.length - 1))
                    : edge.type === 'VENT' || edge.type === 'TUNNEL'
                      ? Math.max(0, state.beta1 - 1)
                      : state.beta1;

            return edge.targetIds.map((targetId) => ({
              nodeId: targetId,
              beta1: nextBeta1,
            }));
          });
        },
      },
    ],
  };
}

export function buildDefaultGgCheckerOptions(
  program: GgProgram,
  defaults: GgCheckerDefaults = {},
): CheckerOptions<GgTopologyState> {
  const terminalNodes = new Set(getGgTerminalNodeIds(program));
  const maxBeta1Exclusive =
    defaults.maxBeta1Exclusive ?? DEFAULT_MAX_BETA1_EXCLUSIVE;

  return {
    maxDepth: defaults.maxDepth ?? DEFAULT_MAX_DEPTH,
    invariants: [
      { name: 'beta1_non_negative', test: (state) => state.beta1 >= 0 },
      { name: 'beta1_lt_bound', test: (state) => state.beta1 < maxBeta1Exclusive },
    ],
    eventual: [
      {
        name: 'eventually_terminal',
        test: (state) => terminalNodes.has(state.nodeId),
      },
      {
        name: 'eventually_beta1_zero',
        test: (state) => state.beta1 === 0,
      },
    ],
  };
}

export async function checkGgProgram(
  sourceText: string,
  options: {
    readonly model?: GgTemporalModelOptions;
    readonly defaults?: GgCheckerDefaults;
    readonly checker?: CheckerOptions<GgTopologyState>;
  } = {},
): Promise<CheckerResult<GgTopologyState>> {
  const program = parseGgProgram(sourceText);
  const model = buildGgTemporalModel(program, options.model);
  const checkerOptions = options.checker ?? buildDefaultGgCheckerOptions(program, options.defaults);
  const checker = new ForkRaceFoldModelChecker<GgTopologyState>();
  return checker.check(model, checkerOptions);
}
