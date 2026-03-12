import type {
  CheckerOptions,
  NamedPredicate,
  QuorumEventuallyProperty,
} from './types.js';

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
/**
 * Quorum temporal operators: `eventually@q` and `until@q`.
 *
 * These are novel operators that bridge temporal logic with distributed
 * consensus. Standard temporal logic asks "does every path satisfy P?"
 * Quorum operators ask "does a sufficient fraction of paths agree on P?"
 *
 * `eventually@0.67 Consensus` means: eventually, at least 67% of
 * superposition branches converge to Consensus. This captures the
 * semantics of Byzantine fault tolerance (BFT ≥ 2/3) and Raft
 * (majority quorum) directly in the temporal formula language.
 *
 * The threshold parameter `q` maps to `QuorumEventuallyProperty.threshold`
 * and is evaluated via `LogicChainSuperposition.measureQuorum()`.
 */
const EVENTUALLY_QUORUM_PATTERN = /^eventually@([+-]?(?:\d+\.?\d*|\.\d+))\s+(.+)$/u;
const UNTIL_QUORUM_PATTERN =
  /^([A-Za-z_][A-Za-z0-9_]*)\s+until@([+-]?(?:\d+\.?\d*|\.\d+))\s+(.+)$/u;
const BARE_GOAL_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*|-?\d+(?:\.\d+)?)$/u;
const GOAL_EXPRESSION_PATTERN =
  /^([A-Za-z_][A-Za-z0-9_]*)\s*==\s*(?:"([^"]*)"|'([^']*)'|([A-Za-z_][A-Za-z0-9_]*|-?\d+(?:\.\d+)?))$/u;

interface GoalExpression {
  readonly keySelectorName: string;
  readonly goalKey: string;
}

export interface AlwaysFormula {
  readonly kind: 'always';
  readonly predicateName: string;
}

export interface EventuallyFormula {
  readonly kind: 'eventually';
  readonly predicateName: string;
}

export interface EventuallyQuorumFormula {
  readonly kind: 'eventually_quorum';
  readonly threshold: number;
  readonly keySelectorName: string;
  readonly goalKey: string;
}

export interface UntilFormula {
  readonly kind: 'until';
  readonly holdPredicateName: string;
  readonly goalPredicateName: string;
}

export interface UntilQuorumFormula {
  readonly kind: 'until_quorum';
  readonly threshold: number;
  readonly holdPredicateName: string;
  readonly keySelectorName: string;
  readonly goalKey: string;
}

export type TemporalFormula =
  | AlwaysFormula
  | EventuallyFormula
  | EventuallyQuorumFormula
  | UntilFormula
  | UntilQuorumFormula;

export interface TemporalFormulaCompileContext<State> {
  readonly predicates: Readonly<
    Record<string, (state: Readonly<State>) => boolean>
  >;
  readonly keySelectors?: Readonly<
    Record<string, (state: Readonly<State>) => string>
  >;
}

export interface CompiledTemporalFormulaSet<State> {
  readonly invariants: readonly NamedPredicate<State>[];
  readonly eventual: readonly NamedPredicate<State>[];
  readonly eventualQuorum: readonly QuorumEventuallyProperty<State>[];
  readonly requiresSuperposition: boolean;
}

function parseIdentifier(token: string, context: string): string {
  if (!IDENTIFIER_PATTERN.test(token)) {
    throw new Error(`Expected identifier for ${context}, got "${token}"`);
  }
  return token;
}

function parseThreshold(rawThreshold: string, operatorName: string): number {
  const parsedThreshold = Number(rawThreshold);
  if (!Number.isFinite(parsedThreshold)) {
    throw new Error(`${operatorName} requires a finite numeric threshold`);
  }
  if (parsedThreshold < 0 || parsedThreshold > 1) {
    throw new Error(
      `${operatorName} threshold must be within [0, 1], got ${parsedThreshold}`,
    );
  }
  return parsedThreshold;
}

function parseGoalExpression(input: string): GoalExpression {
  const match = GOAL_EXPRESSION_PATTERN.exec(input.trim());
  if (!match) {
    throw new Error(
      'Expected goal expression in the form "<keySelector> == <goalKey>"',
    );
  }

  const keySelectorName = parseIdentifier(match[1] ?? '', 'goal key selector');
  const quotedDouble = match[2];
  const quotedSingle = match[3];
  const bare = match[4];
  const goalKey = quotedDouble ?? quotedSingle ?? bare ?? '';

  if (goalKey.length === 0 && quotedDouble === undefined && quotedSingle === undefined) {
    throw new Error('Goal key cannot be empty');
  }

  return {
    keySelectorName,
    goalKey,
  };
}

function canonicalizeStatement(rawStatement: string): string {
  const normalized = rawStatement.trim().replace(/;$/u, '').trim();
  if (normalized.length === 0) {
    throw new Error('Temporal formula cannot be empty');
  }
  return normalized;
}

function parseEventuallyStatement(statement: string): TemporalFormula {
  if (statement.startsWith('eventually@')) {
    const quorumMatch = EVENTUALLY_QUORUM_PATTERN.exec(statement);
    if (!quorumMatch) {
      throw new Error(
        'Malformed eventually@ formula, expected "eventually@<threshold> <goalExpr>"',
      );
    }

    const threshold = parseThreshold(quorumMatch[1] ?? '', 'eventually@');
    const goalExpression = parseGoalExpression(quorumMatch[2] ?? '');
    return {
      kind: 'eventually_quorum',
      threshold,
      keySelectorName: goalExpression.keySelectorName,
      goalKey: goalExpression.goalKey,
    };
  }

  const predicateToken = statement.slice('eventually'.length).trim();
  return {
    kind: 'eventually',
    predicateName: parseIdentifier(predicateToken, 'eventually predicate'),
  };
}

function parseAlwaysStatement(statement: string): TemporalFormula {
  const predicateToken = statement.slice('always'.length).trim();
  return {
    kind: 'always',
    predicateName: parseIdentifier(predicateToken, 'always predicate'),
  };
}

function parseUntilStatement(statement: string): TemporalFormula {
  const quorumMatch = UNTIL_QUORUM_PATTERN.exec(statement);
  if (quorumMatch) {
    const holdPredicateName = parseIdentifier(
      quorumMatch[1] ?? '',
      'until@ hold predicate',
    );
    const threshold = parseThreshold(quorumMatch[2] ?? '', 'until@');
    const goalExpression = parseGoalExpression(quorumMatch[3] ?? '');
    return {
      kind: 'until_quorum',
      threshold,
      holdPredicateName,
      keySelectorName: goalExpression.keySelectorName,
      goalKey: goalExpression.goalKey,
    };
  }

  const tokens = statement.split(/\s+until\s+/u);
  if (tokens.length !== 2) {
    throw new Error(
      'Malformed until formula, expected "<holdPredicate> until <goalPredicate>"',
    );
  }

  const holdPredicateName = parseIdentifier(tokens[0] ?? '', 'until hold predicate');
  const goalPredicateName = parseIdentifier(tokens[1] ?? '', 'until goal predicate');

  return {
    kind: 'until',
    holdPredicateName,
    goalPredicateName,
  };
}

function stripComments(line: string): string {
  const hashIndex = line.indexOf('#');
  const slashIndex = line.indexOf('//');
  let cutIndex = line.length;

  if (hashIndex >= 0) {
    cutIndex = Math.min(cutIndex, hashIndex);
  }
  if (slashIndex >= 0) {
    cutIndex = Math.min(cutIndex, slashIndex);
  }

  return line.slice(0, cutIndex).trim();
}

function resolvePredicate<State>(
  context: TemporalFormulaCompileContext<State>,
  predicateName: string,
): (state: Readonly<State>) => boolean {
  const predicate = context.predicates[predicateName];
  if (!predicate) {
    throw new Error(`Unknown predicate "${predicateName}"`);
  }
  return predicate;
}

function resolveKeySelector<State>(
  context: TemporalFormulaCompileContext<State>,
  selectorName: string,
): (state: Readonly<State>) => string {
  const selector = context.keySelectors?.[selectorName];
  if (!selector) {
    throw new Error(`Unknown quorum key selector "${selectorName}"`);
  }
  return selector;
}

function formatGoalValue(goalKey: string): string {
  if (BARE_GOAL_PATTERN.test(goalKey)) {
    return goalKey;
  }
  return `"${goalKey}"`;
}

export function renderTemporalFormula(formula: TemporalFormula): string {
  switch (formula.kind) {
    case 'always':
      return `always ${formula.predicateName}`;
    case 'eventually':
      return `eventually ${formula.predicateName}`;
    case 'eventually_quorum':
      return `eventually@${formula.threshold} ${formula.keySelectorName} == ${formatGoalValue(formula.goalKey)}`;
    case 'until':
      return `${formula.holdPredicateName} until ${formula.goalPredicateName}`;
    case 'until_quorum':
      return `${formula.holdPredicateName} until@${formula.threshold} ${formula.keySelectorName} == ${formatGoalValue(formula.goalKey)}`;
    default: {
      const exhaustiveCheck: never = formula;
      throw new Error(`Unsupported temporal formula: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

export function parseTemporalFormula(formulaText: string): TemporalFormula {
  const statement = canonicalizeStatement(formulaText);

  if (statement.startsWith('always ')) {
    return parseAlwaysStatement(statement);
  }

  if (statement.startsWith('eventually')) {
    return parseEventuallyStatement(statement);
  }

  if (statement.includes(' until@') || statement.includes(' until ')) {
    return parseUntilStatement(statement);
  }

  throw new Error(
    `Unsupported temporal formula "${statement}". Supported operators: always, eventually, eventually@q, until, until@q`,
  );
}

export function parseTemporalFormulaSet(formulaText: string): readonly TemporalFormula[] {
  const formulas: TemporalFormula[] = [];
  const normalizedText = formulaText.replace(/;/gu, '\n');
  const lines = normalizedText.split(/\r?\n/u);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }

    const strippedLine = stripComments(line);
    if (strippedLine.length === 0) {
      continue;
    }

    try {
      formulas.push(parseTemporalFormula(strippedLine));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Temporal formula parse error on line ${index + 1}: ${message}`);
    }
  }

  return formulas;
}

export function compileTemporalFormula<State>(
  formula: TemporalFormula,
  context: TemporalFormulaCompileContext<State>,
): CompiledTemporalFormulaSet<State> {
  switch (formula.kind) {
    case 'always': {
      const predicate = resolvePredicate(context, formula.predicateName);
      return {
        invariants: [
          {
            name: renderTemporalFormula(formula),
            test: predicate,
          },
        ],
        eventual: [],
        eventualQuorum: [],
        requiresSuperposition: false,
      };
    }
    case 'eventually': {
      const predicate = resolvePredicate(context, formula.predicateName);
      return {
        invariants: [],
        eventual: [
          {
            name: renderTemporalFormula(formula),
            test: predicate,
          },
        ],
        eventualQuorum: [],
        requiresSuperposition: false,
      };
    }
    case 'eventually_quorum': {
      const keySelector = resolveKeySelector(context, formula.keySelectorName);
      return {
        invariants: [],
        eventual: [],
        eventualQuorum: [
          {
            name: renderTemporalFormula(formula),
            keyOfState: keySelector,
            threshold: formula.threshold,
            isGoalKey: (key) => key === formula.goalKey,
          },
        ],
        requiresSuperposition: true,
      };
    }
    case 'until': {
      const holdPredicate = resolvePredicate(context, formula.holdPredicateName);
      const goalPredicate = resolvePredicate(context, formula.goalPredicateName);
      return {
        invariants: [
          {
            name: `${renderTemporalFormula(formula)} [guard]`,
            test: (state) => holdPredicate(state) || goalPredicate(state),
          },
        ],
        eventual: [
          {
            name: `${renderTemporalFormula(formula)} [goal]`,
            test: goalPredicate,
          },
        ],
        eventualQuorum: [],
        requiresSuperposition: false,
      };
    }
    case 'until_quorum': {
      const holdPredicate = resolvePredicate(context, formula.holdPredicateName);
      const keySelector = resolveKeySelector(context, formula.keySelectorName);
      return {
        invariants: [
          {
            name: `${renderTemporalFormula(formula)} [guard]`,
            test: (state) =>
              holdPredicate(state) || keySelector(state) === formula.goalKey,
          },
        ],
        eventual: [],
        eventualQuorum: [
          {
            name: `${renderTemporalFormula(formula)} [goal]`,
            keyOfState: keySelector,
            threshold: formula.threshold,
            isGoalKey: (key) => key === formula.goalKey,
          },
        ],
        requiresSuperposition: true,
      };
    }
    default: {
      const exhaustiveCheck: never = formula;
      throw new Error(`Unsupported temporal formula: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

export function compileTemporalFormulaSet<State>(
  formulas: readonly TemporalFormula[],
  context: TemporalFormulaCompileContext<State>,
): CompiledTemporalFormulaSet<State> {
  const invariants: NamedPredicate<State>[] = [];
  const eventual: NamedPredicate<State>[] = [];
  const eventualQuorum: QuorumEventuallyProperty<State>[] = [];
  let requiresSuperposition = false;

  for (const formula of formulas) {
    const compiled = compileTemporalFormula(formula, context);
    invariants.push(...compiled.invariants);
    eventual.push(...compiled.eventual);
    eventualQuorum.push(...compiled.eventualQuorum);
    requiresSuperposition = requiresSuperposition || compiled.requiresSuperposition;
  }

  return {
    invariants,
    eventual,
    eventualQuorum,
    requiresSuperposition,
  };
}

export function compileTemporalFormulaText<State>(
  formulaText: string,
  context: TemporalFormulaCompileContext<State>,
): CompiledTemporalFormulaSet<State> {
  const formulas = parseTemporalFormulaSet(formulaText);
  return compileTemporalFormulaSet(formulas, context);
}

export function mergeCompiledTemporalFormulasIntoCheckerOptions<State>(
  compiled: CompiledTemporalFormulaSet<State>,
  baseOptions: CheckerOptions<State> = {},
): CheckerOptions<State> {
  const mergedInvariants = [
    ...(baseOptions.invariants ?? []),
    ...compiled.invariants,
  ];
  const mergedEventually = [
    ...(baseOptions.eventual ?? []),
    ...compiled.eventual,
  ];
  const mergedEventuallyQuorum = [
    ...(baseOptions.eventualQuorum ?? []),
    ...compiled.eventualQuorum,
  ];

  const mergedOptions: CheckerOptions<State> = { ...baseOptions };

  if (mergedInvariants.length > 0) {
    Object.assign(mergedOptions, { invariants: mergedInvariants });
  }
  if (mergedEventually.length > 0) {
    Object.assign(mergedOptions, { eventual: mergedEventually });
  }
  if (mergedEventuallyQuorum.length > 0) {
    Object.assign(mergedOptions, { eventualQuorum: mergedEventuallyQuorum });
  }

  if (compiled.requiresSuperposition) {
    const baseSuperposition = baseOptions.superposition;
    if (baseSuperposition) {
      Object.assign(mergedOptions, {
        superposition: { ...baseSuperposition, enabled: true },
      });
    } else {
      Object.assign(mergedOptions, {
        superposition: { enabled: true },
      });
    }
  }

  return mergedOptions;
}
