import { renderTlcArtifactPair } from './tlc-artifacts.js';
import type { TlcArtifactPair } from './tlc-artifacts.js';

export interface SuperpositionArtifactOptions {
  readonly moduleName?: string;
  readonly branchFactor: number;
  readonly maxDepth: number;
  readonly quorumThreshold?: number;
  readonly includeQuorumInvariant?: boolean;
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertThreshold(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(`${name} must be a finite number in (0, 1]`);
  }
}

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

function toFraction(value: number): { numerator: number; denominator: number } {
  const denominator = 10_000;
  const numerator = Math.max(1, Math.round(value * denominator));
  const divisor = gcd(numerator, denominator);
  return {
    numerator: numerator / divisor,
    denominator: denominator / divisor,
  };
}

export function renderSuperpositionArtifactPair(
  options: SuperpositionArtifactOptions,
): TlcArtifactPair {
  const moduleName = options.moduleName ?? 'SuperpositionLogicChains';
  const branchFactor = options.branchFactor;
  const maxDepth = options.maxDepth;
  const quorumThreshold = options.quorumThreshold ?? 0.5;
  const includeQuorumInvariant = options.includeQuorumInvariant ?? true;
  const quorumFraction = toFraction(quorumThreshold);

  assertPositiveInteger('branchFactor', branchFactor);
  assertPositiveInteger('maxDepth', maxDepth);
  assertThreshold('quorumThreshold', quorumThreshold);

  const body = [
    'CONSTANTS BranchFactor, MaxDepth, QuorumNumerator, QuorumDenominator',
    '',
    'VARIABLES depth, activeBranches, measured',
    '',
    'vars == <<depth, activeBranches, measured>>',
    '',
    'Init ==',
    '  /\\ depth = 0',
    '  /\\ activeBranches = 1',
    '  /\\ measured = FALSE',
    '',
    'Expand ==',
    '  /\\ ~measured',
    '  /\\ depth < MaxDepth',
    '  /\\ depth\' = depth + 1',
    '  /\\ activeBranches\' = activeBranches * BranchFactor',
    '  /\\ UNCHANGED measured',
    '',
    'Measure ==',
    '  /\\ ~measured',
    '  /\\ measured\' = TRUE',
    '  /\\ UNCHANGED <<depth, activeBranches>>',
    '',
    'Stutter == UNCHANGED vars',
    '',
    'Next == Expand \\/ Measure \\/ Stutter',
    'Spec == Init /\\ [][Next]_vars',
    '',
    'InvDepthBound == depth <= MaxDepth',
    'InvBranchGrowth == activeBranches = BranchFactor ^ depth',
  ];

  if (includeQuorumInvariant) {
    body.push(
      'InvQuorumWindow == measured => QuorumDenominator <= activeBranches * QuorumNumerator',
    );
  }

  return renderTlcArtifactPair(
    {
      moduleName,
      extends: ['Naturals'],
      body,
    },
    {
      specification: 'Spec',
      constants: [
        { name: 'BranchFactor', operator: '=', value: `${branchFactor}` },
        { name: 'MaxDepth', operator: '=', value: `${maxDepth}` },
        {
          name: 'QuorumNumerator',
          operator: '=',
          value: `${quorumFraction.numerator}`,
        },
        {
          name: 'QuorumDenominator',
          operator: '=',
          value: `${quorumFraction.denominator}`,
        },
      ],
      invariants: includeQuorumInvariant
        ? ['InvDepthBound', 'InvBranchGrowth', 'InvQuorumWindow']
        : ['InvDepthBound', 'InvBranchGrowth'],
      properties: ['<>measured'],
      constraints: [],
    },
  );
}
