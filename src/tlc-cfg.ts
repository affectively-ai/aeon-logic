export interface TlcConstantAssignment {
  readonly name: string;
  readonly operator: '=' | '<-';
  readonly value: string;
}

export interface TlcExtraSection {
  readonly name: string;
  readonly values: readonly string[];
}

export interface TlcConfig {
  readonly specification?: string;
  readonly init?: string;
  readonly next?: string;
  readonly constants: readonly TlcConstantAssignment[];
  readonly invariants: readonly string[];
  readonly properties: readonly string[];
  readonly constraints: readonly string[];
  readonly view?: string;
  readonly symmetry?: string;
  readonly checkDeadlock?: boolean;
  readonly extraSections?: readonly TlcExtraSection[];
}

interface MutableTlcExtraSection {
  readonly name: string;
  readonly values: string[];
}

interface MutableTlcConfig {
  specification?: string;
  init?: string;
  next?: string;
  constants: TlcConstantAssignment[];
  invariants: string[];
  properties: string[];
  constraints: string[];
  view?: string;
  symmetry?: string;
  checkDeadlock?: boolean;
  extraSections: MutableTlcExtraSection[];
}

type KnownHeading =
  | 'SPECIFICATION'
  | 'INIT'
  | 'NEXT'
  | 'CONSTANT'
  | 'CONSTANTS'
  | 'INVARIANT'
  | 'INVARIANTS'
  | 'PROPERTY'
  | 'PROPERTIES'
  | 'CONSTRAINT'
  | 'CONSTRAINTS'
  | 'VIEW'
  | 'SYMMETRY'
  | 'CHECK_DEADLOCK';

const KNOWN_HEADINGS = new Set<KnownHeading>([
  'SPECIFICATION',
  'INIT',
  'NEXT',
  'CONSTANT',
  'CONSTANTS',
  'INVARIANT',
  'INVARIANTS',
  'PROPERTY',
  'PROPERTIES',
  'CONSTRAINT',
  'CONSTRAINTS',
  'VIEW',
  'SYMMETRY',
  'CHECK_DEADLOCK',
]);

const SINGLE_VALUE_HEADINGS = new Set<KnownHeading>([
  'SPECIFICATION',
  'INIT',
  'NEXT',
  'VIEW',
  'SYMMETRY',
  'CHECK_DEADLOCK',
]);

const LIST_VALUE_HEADINGS = new Set<KnownHeading>([
  'CONSTANT',
  'CONSTANTS',
  'INVARIANT',
  'INVARIANTS',
  'PROPERTY',
  'PROPERTIES',
  'CONSTRAINT',
  'CONSTRAINTS',
]);

interface ParsedHeading {
  readonly heading: string;
  readonly remainder: string;
}

function parseHeading(line: string): ParsedHeading | null {
  const match = /^([A-Z][A-Z0-9_]*)(?:\s+(.*))?$/.exec(line);
  if (!match) {
    return null;
  }

  const heading = match[1];
  if (!heading) {
    return null;
  }

  return {
    heading,
    remainder: (match[2] ?? '').trim(),
  };
}

function parseConstantAssignment(line: string, lineNumber: number): TlcConstantAssignment {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*(=|<-)\s*(.+)$/.exec(line);
  if (!match) {
    throw new Error(`Invalid CONSTANT assignment at line ${lineNumber}: "${line}"`);
  }

  const name = match[1];
  const operator = match[2];
  const value = match[3];
  if (!name || !operator || !value) {
    throw new Error(`Incomplete CONSTANT assignment at line ${lineNumber}: "${line}"`);
  }

  return {
    name,
    operator: operator as '=' | '<-',
    value: value.trim(),
  };
}

function parseBoolean(value: string, lineNumber: number): boolean {
  const normalized = value.trim().toUpperCase();
  if (normalized === 'TRUE') {
    return true;
  }
  if (normalized === 'FALSE') {
    return false;
  }

  throw new Error(`Invalid CHECK_DEADLOCK value at line ${lineNumber}: "${value}"`);
}

function stripComment(rawLine: string): string {
  const commentStart = rawLine.indexOf('\\*');
  if (commentStart < 0) {
    return rawLine;
  }
  return rawLine.slice(0, commentStart);
}

function pushExtraSectionValue(
  config: MutableTlcConfig,
  sectionName: string,
  value: string,
): void {
  const existingSection = config.extraSections.find((section) => section.name === sectionName);
  if (existingSection) {
    existingSection.values.push(value);
    return;
  }

  config.extraSections.push({
    name: sectionName,
    values: [value],
  });
}

function pushListValue(
  config: MutableTlcConfig,
  heading: KnownHeading,
  value: string,
  lineNumber: number,
): void {
  switch (heading) {
    case 'CONSTANT':
    case 'CONSTANTS':
      config.constants.push(parseConstantAssignment(value, lineNumber));
      return;
    case 'INVARIANT':
    case 'INVARIANTS':
      config.invariants.push(value);
      return;
    case 'PROPERTY':
    case 'PROPERTIES':
      config.properties.push(value);
      return;
    case 'CONSTRAINT':
    case 'CONSTRAINTS':
      config.constraints.push(value);
      return;
    default:
      throw new Error(`Unhandled list heading "${heading}"`);
  }
}

function assignSingleValue(
  config: MutableTlcConfig,
  heading: KnownHeading,
  value: string,
  lineNumber: number,
): void {
  switch (heading) {
    case 'SPECIFICATION':
      config.specification = value;
      return;
    case 'INIT':
      config.init = value;
      return;
    case 'NEXT':
      config.next = value;
      return;
    case 'VIEW':
      config.view = value;
      return;
    case 'SYMMETRY':
      config.symmetry = value;
      return;
    case 'CHECK_DEADLOCK':
      config.checkDeadlock = parseBoolean(value, lineNumber);
      return;
    default:
      throw new Error(`Unhandled single-value heading "${heading}"`);
  }
}

export function parseTlcConfig(text: string): TlcConfig {
  const config: MutableTlcConfig = {
    constants: [],
    invariants: [],
    properties: [],
    constraints: [],
    extraSections: [],
  };

  let pendingSingleHeading: KnownHeading | null = null;
  let activeListHeading: KnownHeading | null = null;
  let activeExtraSection: string | null = null;

  const lines = text.split(/\r?\n/);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const sourceLine = lines[lineIndex] ?? '';
    const withoutComment = stripComment(sourceLine);
    const line = withoutComment.trim();
    const lineNumber = lineIndex + 1;

    if (line.length === 0) {
      continue;
    }

    const parsedHeading = parseHeading(line);

    if (parsedHeading && KNOWN_HEADINGS.has(parsedHeading.heading as KnownHeading)) {
      const heading = parsedHeading.heading as KnownHeading;
      const remainder = parsedHeading.remainder;

      activeExtraSection = null;
      pendingSingleHeading = null;
      activeListHeading = null;

      if (SINGLE_VALUE_HEADINGS.has(heading)) {
        if (remainder.length > 0) {
          assignSingleValue(config, heading, remainder, lineNumber);
        } else {
          pendingSingleHeading = heading;
        }
        continue;
      }

      if (LIST_VALUE_HEADINGS.has(heading)) {
        activeListHeading = heading;
        if (remainder.length > 0) {
          pushListValue(config, heading, remainder, lineNumber);
        }
        continue;
      }
    }

    if (parsedHeading && !KNOWN_HEADINGS.has(parsedHeading.heading as KnownHeading)) {
      activeListHeading = null;
      pendingSingleHeading = null;
      activeExtraSection = parsedHeading.heading;

      if (parsedHeading.remainder.length > 0) {
        pushExtraSectionValue(config, parsedHeading.heading, parsedHeading.remainder);
      }

      continue;
    }

    if (pendingSingleHeading) {
      assignSingleValue(config, pendingSingleHeading, line, lineNumber);
      pendingSingleHeading = null;
      continue;
    }

    if (activeListHeading) {
      pushListValue(config, activeListHeading, line, lineNumber);
      continue;
    }

    if (activeExtraSection) {
      pushExtraSectionValue(config, activeExtraSection, line);
      continue;
    }

    throw new Error(`Unparsed content at line ${lineNumber}: "${line}"`);
  }

  if (pendingSingleHeading) {
    throw new Error(`Missing value for section "${pendingSingleHeading}"`);
  }

  const extraSections =
    config.extraSections.length > 0
      ? config.extraSections.map((section) => ({
          name: section.name,
          values: [...section.values],
        }))
      : undefined;

  const parsedConfig: TlcConfig = {
    constants: config.constants,
    invariants: config.invariants,
    properties: config.properties,
    constraints: config.constraints,
  };

  if (config.specification !== undefined) {
    Object.assign(parsedConfig, { specification: config.specification });
  }
  if (config.init !== undefined) {
    Object.assign(parsedConfig, { init: config.init });
  }
  if (config.next !== undefined) {
    Object.assign(parsedConfig, { next: config.next });
  }
  if (config.view !== undefined) {
    Object.assign(parsedConfig, { view: config.view });
  }
  if (config.symmetry !== undefined) {
    Object.assign(parsedConfig, { symmetry: config.symmetry });
  }
  if (config.checkDeadlock !== undefined) {
    Object.assign(parsedConfig, { checkDeadlock: config.checkDeadlock });
  }
  if (extraSections !== undefined) {
    Object.assign(parsedConfig, { extraSections });
  }

  return parsedConfig;
}

function pushSection(
  lines: string[],
  heading: string,
  values: readonly string[],
): void {
  if (values.length === 0) {
    return;
  }

  if (lines.length > 0) {
    lines.push('');
  }
  lines.push(heading);
  for (const value of values) {
    lines.push(`  ${value}`);
  }
}

function pushSingleLineSection(
  lines: string[],
  heading: string,
  value: string | undefined,
): void {
  if (!value) {
    return;
  }

  if (lines.length > 0) {
    lines.push('');
  }
  lines.push(`${heading} ${value}`);
}

export function serializeTlcConfig(config: TlcConfig): string {
  const lines: string[] = [];

  pushSingleLineSection(lines, 'SPECIFICATION', config.specification);
  pushSingleLineSection(lines, 'INIT', config.init);
  pushSingleLineSection(lines, 'NEXT', config.next);

  pushSection(
    lines,
    'CONSTANTS',
    config.constants.map(
      (constantAssignment) =>
        `${constantAssignment.name} ${constantAssignment.operator} ${constantAssignment.value}`,
    ),
  );

  pushSection(lines, 'INVARIANTS', config.invariants);
  pushSection(lines, 'PROPERTIES', config.properties);
  pushSection(lines, 'CONSTRAINTS', config.constraints);

  pushSingleLineSection(lines, 'VIEW', config.view);
  pushSingleLineSection(lines, 'SYMMETRY', config.symmetry);

  if (config.checkDeadlock !== undefined) {
    pushSingleLineSection(
      lines,
      'CHECK_DEADLOCK',
      config.checkDeadlock ? 'TRUE' : 'FALSE',
    );
  }

  for (const extraSection of config.extraSections ?? []) {
    pushSection(lines, extraSection.name, extraSection.values);
  }

  if (lines.length === 0) {
    return '';
  }

  return `${lines.join('\n')}\n`;
}
