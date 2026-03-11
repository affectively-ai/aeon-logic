import { describe, expect, it } from 'vitest';

import { parseTlaModule, renderTlaModule } from '../src/index.js';

const sampleModule = `------------------------------ MODULE ForkRaceFoldC1C4 ------------------------------
EXTENDS Naturals, Sequences, FiniteSets

VARIABLES pipeQ, done

Init == pipeQ = <<>> /\\ done = <<>>

=============================================================================
`;

describe('TLA module compatibility', () => {
  it('parses module name, EXTENDS clause, and body', () => {
    const parsed = parseTlaModule(sampleModule);

    expect(parsed.moduleName).toBe('ForkRaceFoldC1C4');
    expect(parsed.extends).toEqual(['Naturals', 'Sequences', 'FiniteSets']);
    expect(parsed.body[0]).toBe('VARIABLES pipeQ, done');
    expect(parsed.body.at(-1)).toBe('Init == pipeQ = <<>> /\\ done = <<>>');
  });

  it('round-trips module rendering', () => {
    const parsed = parseTlaModule(sampleModule);
    const rendered = renderTlaModule(parsed);
    const reparsed = parseTlaModule(rendered);

    expect(reparsed).toEqual(parsed);
  });

  it('renders modules without EXTENDS clauses', () => {
    const rendered = renderTlaModule({
      moduleName: 'SimpleSpec',
      body: ['x == 1'],
    });

    expect(rendered).toContain('MODULE SimpleSpec');
    expect(rendered).toContain('x == 1');
    expect(rendered).toContain('=============================================================================');
  });
});
