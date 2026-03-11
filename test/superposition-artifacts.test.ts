import { describe, expect, it } from 'vitest';

import {
  parseTlaModule,
  parseTlcConfig,
  renderSuperpositionArtifactPair,
} from '../src/index.js';

describe('renderSuperpositionArtifactPair', () => {
  it('renders parseable TLA/CFG artifacts with quorum constants', () => {
    const artifacts = renderSuperpositionArtifactPair({
      moduleName: 'SuperposedLogic',
      branchFactor: 4,
      maxDepth: 6,
      quorumThreshold: 0.75,
    });

    const parsedModule = parseTlaModule(artifacts.tla);
    const parsedConfig = parseTlcConfig(artifacts.cfg);

    expect(parsedModule.moduleName).toBe('SuperposedLogic');
    expect(parsedModule.body.join('\n')).toContain('InvBranchGrowth');
    expect(parsedConfig.constants).toEqual(
      expect.arrayContaining([
        { name: 'BranchFactor', operator: '=', value: '4' },
        { name: 'MaxDepth', operator: '=', value: '6' },
      ]),
    );
    expect(
      parsedConfig.constants.some(
        (constantAssignment) => constantAssignment.name === 'QuorumNumerator',
      ),
    ).toBe(true);
    expect(
      parsedConfig.constants.some(
        (constantAssignment) => constantAssignment.name === 'QuorumDenominator',
      ),
    ).toBe(true);
    expect(parsedConfig.invariants).toContain('InvQuorumWindow');
  });
});
