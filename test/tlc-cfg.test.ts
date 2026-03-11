import { describe, expect, it } from 'vitest';

import { parseTlcConfig, serializeTlcConfig } from '../src/index.js';

const sampleConfig = `SPECIFICATION Spec

CONSTANTS
  ItemCount = 3
  StageCount = 3
  BranchCount = 3
  MaxTime = 4

INVARIANTS
  C1_Locality
  C2_BranchIsolation
  C3_DeterministicFold
  C4_BoundedTermination

PROPERTIES
  Termination
`;

describe('TLC cfg compatibility', () => {
  it('parses canonical TLC config sections', () => {
    const parsed = parseTlcConfig(sampleConfig);

    expect(parsed.specification).toBe('Spec');
    expect(parsed.constants).toEqual([
      { name: 'ItemCount', operator: '=', value: '3' },
      { name: 'StageCount', operator: '=', value: '3' },
      { name: 'BranchCount', operator: '=', value: '3' },
      { name: 'MaxTime', operator: '=', value: '4' },
    ]);
    expect(parsed.invariants).toEqual([
      'C1_Locality',
      'C2_BranchIsolation',
      'C3_DeterministicFold',
      'C4_BoundedTermination',
    ]);
    expect(parsed.properties).toEqual(['Termination']);
  });

  it('round-trips parse -> serialize -> parse', () => {
    const parsed = parseTlcConfig(sampleConfig);
    const serialized = serializeTlcConfig(parsed);
    const reparsed = parseTlcConfig(serialized);

    expect(reparsed).toEqual(parsed);
  });

  it('supports substitution constants, CHECK_DEADLOCK, and unknown sections', () => {
    const withExtras = `INIT Init
NEXT Next
CONSTANTS
  Proc <- ProcModelValue
INVARIANT Safe
CHECK_DEADLOCK FALSE
ALIAS
  ViewAlias ==
    x
`;

    const parsed = parseTlcConfig(withExtras);

    expect(parsed.init).toBe('Init');
    expect(parsed.next).toBe('Next');
    expect(parsed.constants).toEqual([
      { name: 'Proc', operator: '<-', value: 'ProcModelValue' },
    ]);
    expect(parsed.invariants).toEqual(['Safe']);
    expect(parsed.checkDeadlock).toBe(false);
    expect(parsed.extraSections).toEqual([
      {
        name: 'ALIAS',
        values: ['ViewAlias ==', 'x'],
      },
    ]);

    const serialized = serializeTlcConfig(parsed);
    expect(serialized).toContain('CHECK_DEADLOCK FALSE');
    expect(serialized).toContain('ALIAS');
  });
});
