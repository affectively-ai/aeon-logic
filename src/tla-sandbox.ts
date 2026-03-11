import { parseTlaModule, renderTlaModule } from './tla-module.js';
import { parseTlcConfig, serializeTlcConfig } from './tlc-cfg.js';

const TLA_MODULE_HEADER_PATTERN = /^-+\s+MODULE\s+[A-Za-z_][A-Za-z0-9_]*\s+-+$/;
const TLA_MODULE_FOOTER_PATTERN = /^=+$/;
const TLC_HEADING_PATTERN =
  /^(SPECIFICATION|INIT|NEXT|CONSTANTS?|INVARIANTS?|PROPERTIES?|CONSTRAINTS?|VIEW|SYMMETRY|CHECK_DEADLOCK)(?:\s+.*)?$/;

export interface TlaSandboxArtifacts {
  readonly tlaSource: string | null;
  readonly tlcConfigSource: string | null;
}

export interface TlaSandboxModuleReport {
  readonly name: string;
  readonly extends: readonly string[];
  readonly bodyLineCount: number;
  readonly roundTripStable: boolean;
  readonly canonicalSource: string;
}

export interface TlaSandboxConfigReport {
  readonly constants: number;
  readonly invariants: number;
  readonly properties: number;
  readonly constraints: number;
  readonly checkDeadlock: boolean | null;
  readonly roundTripStable: boolean;
  readonly canonicalSource: string;
}

export interface TlaSandboxReport {
  readonly engine: 'aeon-logic';
  readonly mode: 'tla-sandbox';
  readonly runtime: 'wasm-js';
  readonly module?: TlaSandboxModuleReport;
  readonly config?: TlaSandboxConfigReport;
}

export interface TlaSandboxResult {
  readonly report: TlaSandboxReport;
  readonly logs: readonly string[];
  readonly artifacts: TlaSandboxArtifacts;
}

function looksLikeTlcConfig(lines: readonly string[]): boolean {
  return lines.some((line) => TLC_HEADING_PATTERN.test(line.trim()));
}

export function partitionTlaSandboxArtifacts(sourceText: string): TlaSandboxArtifacts {
  const normalized = sourceText.replace(/\r/g, '').trim();
  if (!normalized) {
    return {
      tlaSource: null,
      tlcConfigSource: null,
    };
  }

  const lines = normalized.split('\n');
  const headerIndex = lines.findIndex((line) => TLA_MODULE_HEADER_PATTERN.test(line.trim()));

  if (headerIndex < 0) {
    if (looksLikeTlcConfig(lines)) {
      return {
        tlaSource: null,
        tlcConfigSource: normalized,
      };
    }

    return {
      tlaSource: normalized,
      tlcConfigSource: null,
    };
  }

  let footerIndex = -1;
  for (let lineIndex = lines.length - 1; lineIndex > headerIndex; lineIndex -= 1) {
    if (TLA_MODULE_FOOTER_PATTERN.test(lines[lineIndex]?.trim() ?? '')) {
      footerIndex = lineIndex;
      break;
    }
  }

  if (footerIndex < 0) {
    return {
      tlaSource: normalized,
      tlcConfigSource: null,
    };
  }

  const tlaSource = lines.slice(0, footerIndex + 1).join('\n').trim();
  const tlcConfigSource = lines.slice(footerIndex + 1).join('\n').trim();

  return {
    tlaSource: tlaSource.length > 0 ? tlaSource : null,
    tlcConfigSource: tlcConfigSource.length > 0 ? tlcConfigSource : null,
  };
}

export function runTlaSandbox(sourceText: string): TlaSandboxResult {
  const artifacts = partitionTlaSandboxArtifacts(sourceText);
  const { tlaSource, tlcConfigSource } = artifacts;
  if (!tlaSource && !tlcConfigSource) {
    throw new Error('No TLA module or TLC config content was provided.');
  }

  const logs: string[] = [];
  let moduleReport: TlaSandboxModuleReport | undefined;
  let configReport: TlaSandboxConfigReport | undefined;

  if (tlaSource) {
    logs.push('Parsing TLA module...');
    const parsedModule = parseTlaModule(tlaSource);
    const canonicalModule = renderTlaModule(parsedModule);
    const reparsedModule = parseTlaModule(canonicalModule);

    moduleReport = {
      name: parsedModule.moduleName,
      extends: parsedModule.extends ?? [],
      bodyLineCount: parsedModule.body.length,
      roundTripStable: JSON.stringify(parsedModule) === JSON.stringify(reparsedModule),
      canonicalSource: canonicalModule,
    };
  }

  if (tlcConfigSource) {
    logs.push('Parsing TLC config...');
    const parsedConfig = parseTlcConfig(tlcConfigSource);
    const canonicalConfig = serializeTlcConfig(parsedConfig);
    const reparsedConfig = parseTlcConfig(canonicalConfig);

    configReport = {
      constants: parsedConfig.constants.length,
      invariants: parsedConfig.invariants.length,
      properties: parsedConfig.properties.length,
      constraints: parsedConfig.constraints.length,
      checkDeadlock: parsedConfig.checkDeadlock ?? null,
      roundTripStable: JSON.stringify(parsedConfig) === JSON.stringify(reparsedConfig),
      canonicalSource: canonicalConfig,
    };
  }

  const report: TlaSandboxReport = {
    engine: 'aeon-logic',
    mode: 'tla-sandbox',
    runtime: 'wasm-js',
    ...(moduleReport ? { module: moduleReport } : {}),
    ...(configReport ? { config: configReport } : {}),
  };

  return {
    report,
    logs,
    artifacts,
  };
}
