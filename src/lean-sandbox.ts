import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';

const LEAN_FILE_EXTENSION = '.lean';
const LAKEFILE_LEAN = 'lakefile.lean';
const LAKEFILE_TOML = 'lakefile.toml';
const LEAN_TOOLCHAIN_FILE = 'lean-toolchain';
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.lake',
  'build',
  'dist',
  'node_modules',
  'target',
]);

export interface LeanProjectInspection {
  readonly root: string;
  readonly lakefilePath: string | null;
  readonly toolchainPath: string | null;
  readonly toolchain: string | null;
  readonly sourceDir: string;
  readonly sourceFiles: readonly string[];
  readonly moduleNames: readonly string[];
}

export interface LeanSandboxArtifacts {
  readonly projectRoot: string;
  readonly lakefilePath: string | null;
  readonly toolchainPath: string | null;
  readonly sourceFiles: readonly string[];
}

export interface LeanSandboxToolReport {
  readonly requestedBuild: boolean;
  readonly lakeAvailable: boolean;
  readonly lakePath: string | null;
}

export interface LeanSandboxBuildReport {
  readonly attempted: boolean;
  readonly ok: boolean | null;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface LeanSandboxProjectReport {
  readonly root: string;
  readonly lakefile: string | null;
  readonly toolchainFile: string | null;
  readonly toolchain: string | null;
  readonly sourceDir: string;
  readonly moduleCount: number;
  readonly sourceFiles: readonly string[];
  readonly moduleNames: readonly string[];
}

export interface LeanSandboxReport {
  readonly engine: 'aeon-logic';
  readonly mode: 'lean-sandbox';
  readonly runtime: 'inspect-only' | 'native-process';
  readonly project: LeanSandboxProjectReport;
  readonly tool: LeanSandboxToolReport;
  readonly build: LeanSandboxBuildReport;
}

export interface LeanSandboxResult {
  readonly report: LeanSandboxReport;
  readonly logs: readonly string[];
  readonly artifacts: LeanSandboxArtifacts;
}

export interface LeanSandboxOptions {
  readonly path?: string;
  readonly cwd?: string;
  readonly build?: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

function normalizeSourcePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function isLeanSourceFile(filePath: string): boolean {
  return extname(filePath) === LEAN_FILE_EXTENSION && basename(filePath) !== LAKEFILE_LEAN;
}

function directoryExists(directoryPath: string): boolean {
  try {
    return statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function fileExists(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function hasLeanProjectMarker(directoryPath: string): boolean {
  return (
    fileExists(join(directoryPath, LAKEFILE_LEAN)) ||
    fileExists(join(directoryPath, LAKEFILE_TOML)) ||
    fileExists(join(directoryPath, LEAN_TOOLCHAIN_FILE))
  );
}

function collectLeanSourceFiles(rootPath: string): string[] {
  const sourceFiles: string[] = [];

  const walk = (directoryPath: string): void => {
    for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
      const entryPath = join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) {
          continue;
        }
        walk(entryPath);
        continue;
      }

      if (entry.isFile() && isLeanSourceFile(entryPath)) {
        sourceFiles.push(entryPath);
      }
    }
  };

  walk(rootPath);
  sourceFiles.sort((left, right) => left.localeCompare(right));
  return sourceFiles;
}

function readOptionalFile(filePath: string | null): string | null {
  if (!filePath || !fileExists(filePath)) {
    return null;
  }

  return readFileSync(filePath, 'utf8');
}

function resolveLakefilePath(projectRoot: string): string | null {
  const leanLakefile = join(projectRoot, LAKEFILE_LEAN);
  if (fileExists(leanLakefile)) {
    return leanLakefile;
  }

  const tomlLakefile = join(projectRoot, LAKEFILE_TOML);
  if (fileExists(tomlLakefile)) {
    return tomlLakefile;
  }

  return null;
}

function parseSourceDir(projectRoot: string, lakefilePath: string | null): string {
  const lakefile = readOptionalFile(lakefilePath);
  if (lakefile) {
    const sourceDirMatch =
      /srcDir\s*:=\s*"([^"]+)"/u.exec(lakefile) ??
      /srcDir\s*=\s*"([^"]+)"/u.exec(lakefile);

    const configuredSourceDir = sourceDirMatch?.[1]?.trim();
    if (configuredSourceDir) {
      return resolve(projectRoot, configuredSourceDir);
    }
  }

  const conventionalLeanDir = join(projectRoot, 'Lean');
  if (directoryExists(conventionalLeanDir)) {
    return conventionalLeanDir;
  }

  return projectRoot;
}

function isWithinDirectory(candidatePath: string, directoryPath: string): boolean {
  const relativePath = relative(directoryPath, candidatePath);
  return relativePath.length === 0 || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function toLeanModuleName(filePath: string, sourceDir: string, projectRoot: string): string {
  const relativePath = normalizeSourcePath(
    relative(
      isWithinDirectory(filePath, sourceDir) ? sourceDir : projectRoot,
      filePath,
    ),
  );

  return relativePath
    .replace(/\.lean$/u, '')
    .split('/')
    .filter((segment) => segment.length > 0)
    .join('.');
}

function resolveToolchainPath(projectRoot: string): string | null {
  const toolchainPath = join(projectRoot, LEAN_TOOLCHAIN_FILE);
  return fileExists(toolchainPath) ? toolchainPath : null;
}

function buildSpawnEnv(
  overrides: Readonly<Record<string, string | undefined>> | undefined,
): Record<string, string> {
  const environment: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      environment[key] = value;
    }
  }

  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value === undefined) {
      delete environment[key];
    } else {
      environment[key] = value;
    }
  }

  return environment;
}

function resolveLakeBinary(
  environment: Readonly<Record<string, string>>,
): string | null {
  const homeDirectory = environment.HOME ?? process.env.HOME;
  if (homeDirectory) {
    const elanLakePath = join(
      homeDirectory,
      '.elan',
      'bin',
      process.platform === 'win32' ? 'lake.exe' : 'lake',
    );
    if (existsSync(elanLakePath)) {
      return elanLakePath;
    }
  }

  const probe = spawnSync('lake', ['--version'], {
    encoding: 'utf8',
    env: environment,
  });

  return probe.error ? null : 'lake';
}

function runLakeBuild(
  lakePath: string,
  projectRoot: string,
  environment: Readonly<Record<string, string>>,
): LeanSandboxBuildReport {
  const buildProcess = spawnSync(lakePath, ['build'], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: environment,
  });

  const stderrFromError = buildProcess.error ? `${buildProcess.error.message}\n` : '';
  return {
    attempted: true,
    ok: buildProcess.status === 0,
    exitCode: buildProcess.status ?? null,
    stdout: buildProcess.stdout ?? '',
    stderr: `${buildProcess.stderr ?? ''}${stderrFromError}`,
  };
}

export function findLeanProjectRoot(startPath: string): string | null {
  const resolvedPath = resolve(startPath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`Lean project path does not exist: ${resolvedPath}`);
  }

  const fallbackRoot =
    fileExists(resolvedPath) && isLeanSourceFile(resolvedPath)
      ? dirname(resolvedPath)
      : null;

  let currentPath = directoryExists(resolvedPath)
    ? resolvedPath
    : dirname(resolvedPath);

  while (true) {
    if (hasLeanProjectMarker(currentPath)) {
      return currentPath;
    }

    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) {
      break;
    }
    currentPath = parentPath;
  }

  if (fallbackRoot) {
    return fallbackRoot;
  }

  if (directoryExists(resolvedPath)) {
    const sourceFiles = collectLeanSourceFiles(resolvedPath);
    if (sourceFiles.length > 0) {
      return resolvedPath;
    }
  }

  return null;
}

export function inspectLeanProject(startPath: string): LeanProjectInspection {
  const projectRoot = findLeanProjectRoot(startPath);
  if (!projectRoot) {
    throw new Error(`No Lean project root or .lean source was found for ${resolve(startPath)}`);
  }

  const lakefilePath = resolveLakefilePath(projectRoot);
  const toolchainPath = resolveToolchainPath(projectRoot);
  const sourceDir = parseSourceDir(projectRoot, lakefilePath);
  const sourceFiles = collectLeanSourceFiles(projectRoot);

  if (sourceFiles.length === 0) {
    throw new Error(`No Lean source files were found in ${projectRoot}`);
  }

  return {
    root: projectRoot,
    lakefilePath,
    toolchainPath,
    toolchain: readOptionalFile(toolchainPath)?.trim() ?? null,
    sourceDir,
    sourceFiles,
    moduleNames: sourceFiles.map((filePath) =>
      toLeanModuleName(filePath, sourceDir, projectRoot),
    ),
  };
}

export function runLeanSandbox(
  options: LeanSandboxOptions = {},
): LeanSandboxResult {
  const targetPath = resolve(options.path ?? options.cwd ?? process.cwd());
  const inspection = inspectLeanProject(targetPath);
  const environment = buildSpawnEnv(options.env);
  const buildRequested = options.build ?? true;
  const lakePath = inspection.lakefilePath ? resolveLakeBinary(environment) : null;
  const logs: string[] = [];

  logs.push(`Resolved Lean project root: ${inspection.root}`);
  logs.push(`Discovered ${inspection.sourceFiles.length} Lean source file(s).`);

  if (inspection.toolchain) {
    logs.push(`Detected Lean toolchain: ${inspection.toolchain}`);
  }

  let buildReport: LeanSandboxBuildReport = {
    attempted: false,
    ok: null,
    exitCode: null,
    stdout: '',
    stderr: '',
  };

  if (!buildRequested) {
    logs.push('Build disabled; returning Lean project inspection only.');
  } else if (!inspection.lakefilePath) {
    logs.push('No Lake configuration found; skipping build.');
  } else if (!lakePath) {
    logs.push('Lake binary not found; skipping build.');
  } else {
    logs.push('Running lake build...');
    buildReport = runLakeBuild(lakePath, inspection.root, environment);
    logs.push(buildReport.ok ? 'Lean build passed.' : 'Lean build failed.');
  }

  return {
    report: {
      engine: 'aeon-logic',
      mode: 'lean-sandbox',
      runtime: buildReport.attempted ? 'native-process' : 'inspect-only',
      project: {
        root: inspection.root,
        lakefile: inspection.lakefilePath,
        toolchainFile: inspection.toolchainPath,
        toolchain: inspection.toolchain,
        sourceDir: inspection.sourceDir,
        moduleCount: inspection.moduleNames.length,
        sourceFiles: inspection.sourceFiles,
        moduleNames: inspection.moduleNames,
      },
      tool: {
        requestedBuild: buildRequested,
        lakeAvailable: lakePath !== null,
        lakePath,
      },
      build: buildReport,
    },
    logs,
    artifacts: {
      projectRoot: inspection.root,
      lakefilePath: inspection.lakefilePath,
      toolchainPath: inspection.toolchainPath,
      sourceFiles: inspection.sourceFiles,
    },
  };
}
