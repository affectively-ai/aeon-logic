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

  it('parses multiline CONSTANT assignments with nested sets', () => {
    const multilineConstants = `SPECIFICATION Spec
CONSTANTS
  AllowedFamilies = {
    {0, 1, 2, 5, 6, 7, 8},
    {0, 1, 3, 4, 7, 8}
  }
INVARIANTS
  InvAllowedSubset
`;

    const parsed = parseTlcConfig(multilineConstants);
    expect(parsed.constants).toHaveLength(1);

    const assignment = parsed.constants[0];
    expect(assignment?.name).toBe('AllowedFamilies');
    expect(assignment?.operator).toBe('=');
    expect(assignment?.value.startsWith('{')).toBe(true);
    expect(assignment?.value.endsWith('}')).toBe(true);
    expect(assignment?.value).toContain('{0, 1, 2, 5, 6, 7, 8}');
    expect(assignment?.value).toContain('{0, 1, 3, 4, 7, 8}');

    const serialized = serializeTlcConfig(parsed);
    const reparsed = parseTlcConfig(serialized);
    expect(reparsed).toEqual(parsed);
  });

  it('throws on unterminated multiline CONSTANT assignment', () => {
    const malformed = `CONSTANTS
  AllowedFamilies = {
    {0, 1, 2}
`;

    expect(() => parseTlcConfig(malformed)).toThrow(
      /Unterminated CONSTANT assignment/,
    );
  });
});
