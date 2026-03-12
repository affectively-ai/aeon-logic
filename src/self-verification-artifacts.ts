/**
 * TLA+ self-verification artifacts.
 *
 * Generates a TLA+ specification that models the checker's own BFS
 * exploration, allowing the checker to be verified by TLC or by the
 * Aeon Logic sandbox — the checker verifying itself in TLA+.
 */
import { renderTlcArtifactPair } from './tlc-artifacts.js';
import type { TlcArtifactPair } from './tlc-artifacts.js';

export interface SelfVerificationArtifactOptions {
  readonly moduleName?: string;
  readonly maxExplored: number;
  readonly maxFrontier: number;
  readonly maxDepth: number;
  readonly maxTransitions: number;
}

export function renderSelfVerificationArtifactPair(
  options: SelfVerificationArtifactOptions,
): TlcArtifactPair {
  const moduleName = options.moduleName ?? 'CheckerSelfVerification';

  const body = [
    'CONSTANTS MaxExplored, MaxFrontier, MaxDepth, MaxTransitions',
    '',
    'VARIABLES explored, frontier, transitions, folded, forks, vents, depth, done',
    '',
    'vars == <<explored, frontier, transitions, folded, forks, vents, depth, done>>',
    '',
    'Init ==',
    '  /\\ explored = 1',
    '  /\\ frontier = 1',
    '  /\\ transitions = 0',
    '  /\\ folded = 0',
    '  /\\ forks = 0',
    '  /\\ vents = 0',
    '  /\\ depth = 0',
    '  /\\ done = FALSE',
    '',
    '\\* Process a frontier node, produce one new successor (linear expansion)',
    'ExpandLinear ==',
    '  /\\ ~done',
    '  /\\ frontier > 0',
    '  /\\ explored < MaxExplored',
    '  /\\ transitions < MaxTransitions',
    '  /\\ explored\' = explored + 1',
    '  /\\ frontier\' = frontier',
    '  /\\ transitions\' = transitions + 1',
    '  /\\ UNCHANGED <<folded, forks, vents, depth, done>>',
    '',
    '\\* Process a frontier node, produce two successors (fork)',
    'ExpandFork ==',
    '  /\\ ~done',
    '  /\\ frontier > 0',
    '  /\\ explored + 1 < MaxExplored',
    '  /\\ frontier < MaxFrontier',
    '  /\\ transitions + 1 < MaxTransitions',
    '  /\\ explored\' = explored + 2',
    '  /\\ frontier\' = frontier + 1',
    '  /\\ transitions\' = transitions + 2',
    '  /\\ forks\' = forks + 1',
    '  /\\ UNCHANGED <<folded, vents, depth, done>>',
    '',
    '\\* Successor hits already-visited state (interference / fold)',
    'FoldTransition ==',
    '  /\\ ~done',
    '  /\\ frontier > 0',
    '  /\\ explored > 1',
    '  /\\ transitions < MaxTransitions',
    '  /\\ transitions\' = transitions + 1',
    '  /\\ folded\' = folded + 1',
    '  /\\ UNCHANGED <<explored, frontier, forks, vents, depth, done>>',
    '',
    '\\* Filter an unfair cycle (vent)',
    'VentCycle ==',
    '  /\\ ~done',
    '  /\\ folded > vents',
    '  /\\ vents\' = vents + 1',
    '  /\\ UNCHANGED <<explored, frontier, transitions, folded, forks, depth, done>>',
    '',
    '\\* Complete a BFS layer',
    'CompleteLayer ==',
    '  /\\ ~done',
    '  /\\ frontier > 0',
    '  /\\ depth < MaxDepth',
    '  /\\ depth\' = depth + 1',
    '  /\\ UNCHANGED <<explored, frontier, transitions, folded, forks, vents, done>>',
    '',
    '\\* Exploration complete',
    'Finish ==',
    '  /\\ ~done',
    '  /\\ depth > 0',
    '  /\\ done\' = TRUE',
    '  /\\ frontier\' = 0',
    '  /\\ UNCHANGED <<explored, transitions, folded, forks, vents, depth>>',
    '',
    'Next == ExpandLinear \\/ ExpandFork \\/ FoldTransition \\/ VentCycle \\/ CompleteLayer \\/ Finish',
    'Spec == Init /\\ [][Next]_vars /\\ WF_vars(Finish)',
    '',
    '\\* --- Invariants ---',
    '',
    '\\* Folds never exceed total transitions',
    'InvFoldsLeqTransitions == folded <= transitions',
    '',
    '\\* Vents never exceed folds',
    'InvVentsLeqFolds == vents <= folded',
    '',
    '\\* Explored is always positive',
    'InvExploredPositive == explored >= 1',
    '',
    '\\* Frontier is non-negative',
    'InvFrontierNonNeg == frontier >= 0',
    '',
    '\\* Depth is bounded',
    'InvDepthBounded == depth <= MaxDepth',
    '',
    '\\* Beta1 (first Betti number) is non-negative:',
    '\\* beta1 = transitions - explored + 1 >= 0',
    'InvBeta1NonNeg == transitions - explored + 1 >= 0',
    '',
    '\\* Beta1 equals folded transitions (back-edges in BFS tree)',
    'InvBeta1EqFolded == folded = transitions - explored + 1',
    '',
    '\\* --- Liveness ---',
    '',
    '\\* The checker eventually terminates',
    'EventuallyDone == <>done',
  ];

  return renderTlcArtifactPair(
    {
      moduleName,
      extends: ['Naturals'],
      body,
    },
    {
      specification: 'Spec',
      constants: [
        { name: 'MaxExplored', operator: '=', value: `${options.maxExplored}` },
        { name: 'MaxFrontier', operator: '=', value: `${options.maxFrontier}` },
        { name: 'MaxDepth', operator: '=', value: `${options.maxDepth}` },
        { name: 'MaxTransitions', operator: '=', value: `${options.maxTransitions}` },
      ],
      invariants: [
        'InvFoldsLeqTransitions',
        'InvVentsLeqFolds',
        'InvExploredPositive',
        'InvFrontierNonNeg',
        'InvDepthBounded',
        'InvBeta1NonNeg',
        'InvBeta1EqFolded',
      ],
      properties: ['EventuallyDone'],
      constraints: [],
    },
  );
}
