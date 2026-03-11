const MODULE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_PATTERN = /^-+\s+MODULE\s+([A-Za-z_][A-Za-z0-9_]*)\s+-+$/;
const EXTENDS_PATTERN = /^EXTENDS\s+(.+)$/;
const FOOTER_PATTERN = /^=+$/;
const DEFAULT_FOOTER = '=============================================================================';
const HEADER_DASH_COUNT = 30;

export interface TlaModule {
  readonly moduleName: string;
  readonly extends?: readonly string[];
  readonly body: readonly string[];
}

function formatHeader(moduleName: string): string {
  const dashes = '-'.repeat(HEADER_DASH_COUNT);
  return `${dashes} MODULE ${moduleName} ${dashes}`;
}

function parseExtendsClause(extendsLine: string): readonly string[] {
  const match = EXTENDS_PATTERN.exec(extendsLine.trim());
  if (!match) {
    return [];
  }

  const moduleList = match[1];
  if (!moduleList) {
    return [];
  }

  return moduleList
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function parseTlaModule(sourceText: string): TlaModule {
  const lines = sourceText.replace(/\r/g, '').split('\n');

  const headerIndex = lines.findIndex((line) => HEADER_PATTERN.test(line.trim()));
  if (headerIndex < 0) {
    throw new Error('TLA module header not found');
  }

  const headerMatch = HEADER_PATTERN.exec(lines[headerIndex]?.trim() ?? '');
  if (!headerMatch) {
    throw new Error('TLA module header parse failed');
  }

  const moduleName = headerMatch[1];
  if (!moduleName) {
    throw new Error('TLA module name missing in header');
  }

  let footerIndex = -1;
  for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex -= 1) {
    if (FOOTER_PATTERN.test(lines[lineIndex]?.trim() ?? '')) {
      footerIndex = lineIndex;
      break;
    }
  }

  if (footerIndex < 0 || footerIndex <= headerIndex) {
    throw new Error('TLA module footer not found');
  }

  let bodyStart = headerIndex + 1;
  while (bodyStart < footerIndex && (lines[bodyStart]?.trim() ?? '') === '') {
    bodyStart += 1;
  }

  let extendsModules: readonly string[] | undefined;
  if (bodyStart < footerIndex) {
    const potentialExtendsLine = lines[bodyStart]?.trim() ?? '';
    if (EXTENDS_PATTERN.test(potentialExtendsLine)) {
      extendsModules = parseExtendsClause(potentialExtendsLine);
      bodyStart += 1;
      while (bodyStart < footerIndex && (lines[bodyStart]?.trim() ?? '') === '') {
        bodyStart += 1;
      }
    }
  }

  const body = lines.slice(bodyStart, footerIndex);
  while (body.length > 0 && body[0]?.trim() === '') {
    body.shift();
  }
  while (body.length > 0 && body[body.length - 1]?.trim() === '') {
    body.pop();
  }

  const parsedModule: TlaModule = {
    moduleName,
    body,
  };

  if (extendsModules && extendsModules.length > 0) {
    return {
      ...parsedModule,
      extends: extendsModules,
    };
  }

  return parsedModule;
}

export function renderTlaModule(moduleDefinition: TlaModule): string {
  if (!MODULE_NAME_PATTERN.test(moduleDefinition.moduleName)) {
    throw new Error(`Invalid TLA module name "${moduleDefinition.moduleName}"`);
  }

  const lines: string[] = [];
  lines.push(formatHeader(moduleDefinition.moduleName));

  const extendsModules = moduleDefinition.extends ?? [];
  if (extendsModules.length > 0) {
    lines.push(`EXTENDS ${extendsModules.join(', ')}`);
  }

  if (moduleDefinition.body.length > 0) {
    lines.push('');
    lines.push(...moduleDefinition.body);
  }

  if (lines[lines.length - 1] !== '') {
    lines.push('');
  }
  lines.push(DEFAULT_FOOTER);

  return `${lines.join('\n')}\n`;
}
