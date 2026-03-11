import type { TlaModule } from './tla-module.js';
import type { TlcConfig } from './tlc-cfg.js';
import { renderTlaModule } from './tla-module.js';
import { serializeTlcConfig } from './tlc-cfg.js';

export interface TlcArtifactPair {
  readonly tla: string;
  readonly cfg: string;
}

export function renderTlcArtifactPair(
  moduleDefinition: TlaModule,
  tlcConfig: TlcConfig,
): TlcArtifactPair {
  return {
    tla: renderTlaModule(moduleDefinition),
    cfg: serializeTlcConfig(tlcConfig),
  };
}
