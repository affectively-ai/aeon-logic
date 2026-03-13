import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  findLeanProjectRoot,
  inspectLeanProject,
  runLeanSandbox,
} from '../src/index.js';

const createdDirectories: string[] = [];

function createLeanProjectFixture(): {
  readonly root: string;
  readonly nestedModulePath: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'aeon-logic-lean-'));
  createdDirectories.push(root);

  mkdirSync(join(root, 'Lean', 'Example'), { recursive: true });
  writeFileSync(
    join(root, 'lakefile.lean'),
    `import Lake
open Lake DSL

package "Example" where
  srcDir := "Lean"
`,
  );
  writeFileSync(join(root, 'lean-toolchain'), 'leanprover/lean4:v4.28.0\n');
  writeFileSync(
    join(root, 'Lean', 'Example.lean'),
    'theorem root_identity : 1 = 1 := by rfl\n',
  );
  writeFileSync(
    join(root, 'Lean', 'Example', 'Proof.lean'),
    'theorem nested_identity : 2 = 2 := by rfl\n',
  );

  return {
    root,
    nestedModulePath: join(root, 'Lean', 'Example', 'Proof.lean'),
  };
}

afterEach(() => {
  while (createdDirectories.length > 0) {
    const directoryPath = createdDirectories.pop();
    if (directoryPath) {
      rmSync(directoryPath, { recursive: true, force: true });
    }
  }
});

describe('Lean sandbox helpers', () => {
  it('finds the Lean project root from a nested module path', () => {
    const fixture = createLeanProjectFixture();

    expect(findLeanProjectRoot(fixture.nestedModulePath)).toBe(fixture.root);
  });

  it('inspects Lean project metadata and derives module names', () => {
    const fixture = createLeanProjectFixture();
    const inspection = inspectLeanProject(fixture.root);

    expect(inspection.root).toBe(fixture.root);
    expect(inspection.toolchain).toBe('leanprover/lean4:v4.28.0');
    expect(inspection.sourceFiles).toHaveLength(2);
    expect(inspection.moduleNames).toEqual([
      'Example',
      'Example.Proof',
    ]);
    expect(inspection.sourceDir).toBe(join(fixture.root, 'Lean'));
  });

  it('runs in inspect-only mode when build is disabled', () => {
    const fixture = createLeanProjectFixture();
    const result = runLeanSandbox({
      path: fixture.root,
      build: false,
    });

    expect(result.report.mode).toBe('lean-sandbox');
    expect(result.report.runtime).toBe('inspect-only');
    expect(result.report.project.moduleCount).toBe(2);
    expect(result.report.build.attempted).toBe(false);
    expect(result.report.build.ok).toBeNull();
    expect(result.logs).toContain(
      'Build disabled; returning Lean project inspection only.',
    );
  });

  it('supports single Lean files without a Lake project', () => {
    const root = mkdtempSync(join(tmpdir(), 'aeon-logic-lean-file-'));
    createdDirectories.push(root);

    const modulePath = join(root, 'Solo.lean');
    writeFileSync(modulePath, 'theorem solo_identity : 3 = 3 := by rfl\n');

    const result = runLeanSandbox({
      path: modulePath,
      build: true,
    });

    expect(result.report.project.lakefile).toBeNull();
    expect(result.report.project.moduleNames).toEqual(['Solo']);
    expect(result.report.runtime).toBe('inspect-only');
    expect(result.logs).toContain('No Lake configuration found; skipping build.');
  });
});
