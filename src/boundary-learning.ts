import { ForkRaceFoldModelChecker } from './checker.js';
import type {
  CheckerOptions,
  CheckerResult,
  NamedPredicate,
  TemporalModel,
  TraceStep,
  Violation,
} from './types.js';

export interface InversionSpec<State> {
  readonly name: string;
  readonly predicate: NamedPredicate<State>;
  readonly oppositeName?: string;
  readonly oppositePredicate?: NamedPredicate<State>;
  readonly description?: string;
}

export interface InversionPair<State> {
  readonly id: string;
  readonly name: string;
  readonly claim: NamedPredicate<State>;
  readonly opposite: NamedPredicate<State>;
  readonly description?: string;
}

export interface InversionCheckOutcome<State> {
  readonly pair: InversionPair<State>;
  readonly claim: PredicateCheckOutcome<State>;
  readonly opposite: PredicateCheckOutcome<State>;
  /** claim.score - opposite.score */
  readonly separationDelta: number;
}

export interface PredicateCheckOutcome<State> {
  readonly predicateName: string;
  readonly satisfied: boolean;
  readonly score: number;
  readonly result: CheckerResult<State>;
  readonly firstTrace?: readonly TraceStep<State>[];
}

export interface SweepRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export interface BoundarySweepConfig<State> {
  readonly model: TemporalModel<State>;
  readonly pair: InversionPair<State>;
  readonly depth: SweepRange;
  readonly pressure: SweepRange;
  readonly checker?: ForkRaceFoldModelChecker<State>;
  readonly baseOptions?: CheckerOptions<State>;
  readonly pressureToOptions?: (
    pressure: number,
    baseOptions: CheckerOptions<State>,
  ) => CheckerOptions<State>;
}

export interface BoundarySweepPoint<State> {
  readonly depth: number;
  readonly pressure: number;
  readonly outcome: InversionCheckOutcome<State>;
}

export interface BoundaryFrontier<State> {
  readonly axis: 'depth' | 'pressure';
  readonly from: BoundarySweepPoint<State>;
  readonly to: BoundarySweepPoint<State>;
}

export interface BoundarySweepResult<State> {
  readonly depthValues: readonly number[];
  readonly pressureValues: readonly number[];
  readonly points: readonly BoundarySweepPoint<State>[];
  readonly frontiers: readonly BoundaryFrontier<State>[];
}

export interface BoundaryLearningSuiteSpec<State> {
  readonly tightenVsWaste: InversionPair<State>;
  readonly breakVsRepair: InversionPair<State>;
  readonly truthMinVsTruthMax: InversionPair<State>;
}

export interface BoundaryLearningSuiteConfig<State> {
  readonly model: TemporalModel<State>;
  readonly suite: BoundaryLearningSuiteSpec<State>;
  readonly depth: SweepRange;
  readonly pressure: SweepRange;
  readonly checker?: ForkRaceFoldModelChecker<State>;
  readonly baseOptions?: CheckerOptions<State>;
  readonly pressureToOptions?: (
    pressure: number,
    baseOptions: CheckerOptions<State>,
  ) => CheckerOptions<State>;
}

export interface PairLearningOutcome<State> {
  readonly pairId: string;
  readonly pairName: string;
  readonly claimName: string;
  readonly oppositeName: string;
  readonly claimSatisfied: boolean;
  readonly oppositeSatisfied: boolean;
  readonly claimScore: number;
  readonly oppositeScore: number;
  readonly delta: number;
  readonly claimTrace?: readonly TraceStep<State>[];
  readonly oppositeTrace?: readonly TraceStep<State>[];
}

export interface BoundaryLearningReport<State> {
  readonly tightenVsWaste: PairLearningOutcome<State>;
  readonly breakVsRepair: PairLearningOutcome<State>;
  readonly truthMinVsTruthMax: PairLearningOutcome<State>;
  readonly breakVsRepairFrontiers: readonly BoundaryFrontier<State>[];
  readonly nextProbes: readonly string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sanitizeIdToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function rangeValues(range: SweepRange): number[] {
  if (range.step <= 0) {
    throw new Error('SweepRange.step must be greater than 0.');
  }
  if (range.max < range.min) {
    throw new Error('SweepRange.max must be greater than or equal to min.');
  }

  const values: number[] = [];
  for (let value = range.min; value <= range.max + Number.EPSILON; value += range.step) {
    values.push(Number(value.toFixed(9)));
  }
  return values;
}

function violationForPredicate<State>(
  result: CheckerResult<State>,
  predicateName: string,
): Violation<State> | undefined {
  return result.violations.find(
    (violation) => violation.kind === 'invariant' && violation.name === predicateName,
  );
}

function scoreCheckerResult<State>(result: CheckerResult<State>): number {
  let score = 1;

  if (!result.ok) {
    score -= 0.45;
  }

  score -= Math.min(0.35, result.violations.length * 0.15);

  if (!result.complete) {
    score -= 0.1;
  }

  score -= Math.min(
    0.2,
    (result.topology.wally ?? result.topology.frontierDeficit) * 0.2,
  );

  return clamp(score, 0, 1);
}

function addInvariant<State>(
  options: CheckerOptions<State>,
  predicate: NamedPredicate<State>,
): CheckerOptions<State> {
  const existing = options.invariants ?? [];
  const deduped = existing.filter((entry) => entry.name !== predicate.name);

  return {
    ...options,
    invariants: [...deduped, predicate],
  };
}

function defaultPressureToOptions<State>(
  pressure: number,
  baseOptions: CheckerOptions<State>,
): CheckerOptions<State> {
  const normalized = clamp(pressure, 0, 1);
  const baselineMaxStates = Math.max(16, baseOptions.maxStates ?? 200_000);
  const scaledMaxStates = Math.max(
    16,
    Math.round(baselineMaxStates * (1 - normalized * 0.85)),
  );

  return {
    ...baseOptions,
    maxStates: scaledMaxStates,
  };
}

function pointKey(depth: number, pressure: number): string {
  return `${depth}::${pressure}`;
}

function satisfactionSignature<State>(point: BoundarySweepPoint<State>): string {
  const claim = point.outcome.claim.satisfied ? '1' : '0';
  const opposite = point.outcome.opposite.satisfied ? '1' : '0';
  return `${claim}${opposite}`;
}

function toPairLearningOutcome<State>(
  outcome: InversionCheckOutcome<State>,
): PairLearningOutcome<State> {
  return {
    pairId: outcome.pair.id,
    pairName: outcome.pair.name,
    claimName: outcome.claim.predicateName,
    oppositeName: outcome.opposite.predicateName,
    claimSatisfied: outcome.claim.satisfied,
    oppositeSatisfied: outcome.opposite.satisfied,
    claimScore: outcome.claim.score,
    oppositeScore: outcome.opposite.score,
    delta: outcome.separationDelta,
    ...(outcome.claim.firstTrace ? { claimTrace: outcome.claim.firstTrace } : {}),
    ...(outcome.opposite.firstTrace ? { oppositeTrace: outcome.opposite.firstTrace } : {}),
  };
}

export function createInversionPair<State>(spec: InversionSpec<State>): InversionPair<State> {
  const opposite =
    spec.oppositePredicate ??
    ({
      name: spec.oppositeName ?? `${spec.predicate.name}_opposite`,
      test: (state: Readonly<State>) => !spec.predicate.test(state),
    } as const satisfies NamedPredicate<State>);

  const id = [spec.name, spec.predicate.name, opposite.name]
    .map(sanitizeIdToken)
    .join(':');

  return {
    id,
    name: spec.name,
    claim: spec.predicate,
    opposite,
    ...(spec.description ? { description: spec.description } : {}),
  };
}

export async function runInversionCheck<State>(
  model: TemporalModel<State>,
  pair: InversionPair<State>,
  options: CheckerOptions<State> = {},
  checker = new ForkRaceFoldModelChecker<State>(),
): Promise<InversionCheckOutcome<State>> {
  const claimOptions = addInvariant(options, pair.claim);
  const claimResult = await checker.check(model, claimOptions);
  const claimViolation = violationForPredicate(claimResult, pair.claim.name);

  const oppositeOptions = addInvariant(options, pair.opposite);
  const oppositeResult = await checker.check(model, oppositeOptions);
  const oppositeViolation = violationForPredicate(oppositeResult, pair.opposite.name);

  const claimScore = scoreCheckerResult(claimResult);
  const oppositeScore = scoreCheckerResult(oppositeResult);
  const claim = {
    predicateName: pair.claim.name,
    satisfied: claimViolation == null,
    score: claimScore,
    result: claimResult,
    ...(claimViolation ? { firstTrace: claimViolation.trace } : {}),
  } satisfies PredicateCheckOutcome<State>;
  const opposite = {
    predicateName: pair.opposite.name,
    satisfied: oppositeViolation == null,
    score: oppositeScore,
    result: oppositeResult,
    ...(oppositeViolation ? { firstTrace: oppositeViolation.trace } : {}),
  } satisfies PredicateCheckOutcome<State>;

  return {
    pair,
    claim,
    opposite,
    separationDelta: claimScore - oppositeScore,
  };
}

export async function runBoundarySweep<State>(
  config: BoundarySweepConfig<State>,
): Promise<BoundarySweepResult<State>> {
  const checker = config.checker ?? new ForkRaceFoldModelChecker<State>();
  const baseOptions = config.baseOptions ?? {};
  const pressureToOptions = config.pressureToOptions ?? defaultPressureToOptions;

  const depthValues = rangeValues(config.depth);
  const pressureValues = rangeValues(config.pressure);
  const points: BoundarySweepPoint<State>[] = [];
  const pointMap = new Map<string, BoundarySweepPoint<State>>();

  for (const depth of depthValues) {
    for (const pressure of pressureValues) {
      const pressureOptions = pressureToOptions(pressure, baseOptions);
      const options: CheckerOptions<State> = {
        ...pressureOptions,
        maxDepth: Math.max(1, Math.floor(depth)),
      };

      const outcome = await runInversionCheck(
        config.model,
        config.pair,
        options,
        checker,
      );

      const point: BoundarySweepPoint<State> = {
        depth,
        pressure,
        outcome,
      };

      points.push(point);
      pointMap.set(pointKey(depth, pressure), point);
    }
  }

  const frontiers: BoundaryFrontier<State>[] = [];

  for (const depth of depthValues) {
    for (let index = 1; index < pressureValues.length; index += 1) {
      const leftPressure = pressureValues[index - 1];
      const rightPressure = pressureValues[index];
      if (leftPressure == null || rightPressure == null) continue;
      const left = pointMap.get(pointKey(depth, leftPressure));
      const right = pointMap.get(pointKey(depth, rightPressure));
      if (!left || !right) continue;
      if (satisfactionSignature(left) !== satisfactionSignature(right)) {
        frontiers.push({ axis: 'pressure', from: left, to: right });
      }
    }
  }

  for (const pressure of pressureValues) {
    for (let index = 1; index < depthValues.length; index += 1) {
      const lowDepth = depthValues[index - 1];
      const highDepth = depthValues[index];
      if (lowDepth == null || highDepth == null) continue;
      const low = pointMap.get(pointKey(lowDepth, pressure));
      const high = pointMap.get(pointKey(highDepth, pressure));
      if (!low || !high) continue;
      if (satisfactionSignature(low) !== satisfactionSignature(high)) {
        frontiers.push({ axis: 'depth', from: low, to: high });
      }
    }
  }

  return {
    depthValues,
    pressureValues,
    points,
    frontiers,
  };
}

export function composeBoundaryLearningReport<State>(input: {
  readonly tightenVsWaste: InversionCheckOutcome<State>;
  readonly breakVsRepair: InversionCheckOutcome<State>;
  readonly truthMinVsTruthMax: InversionCheckOutcome<State>;
  readonly breakVsRepairFrontiers: readonly BoundaryFrontier<State>[];
}): BoundaryLearningReport<State> {
  const tightenVsWaste = toPairLearningOutcome(input.tightenVsWaste);
  const breakVsRepair = toPairLearningOutcome(input.breakVsRepair);
  const truthMinVsTruthMax = toPairLearningOutcome(input.truthMinVsTruthMax);

  const nextProbes: string[] = [];

  if (tightenVsWaste.delta < 0.1) {
    nextProbes.push(
      'Increase evidence constraints and reduce optional reasoning branches for tighten-vs-waste separation.',
    );
  }

  if (breakVsRepair.delta < 0) {
    nextProbes.push(
      'Repair currently underperforms break pressure; add contradiction recovery rules and state guards.',
    );
  }

  if (truthMinVsTruthMax.delta < 0.15) {
    nextProbes.push(
      'Truth-pressure separation is narrow; tighten truth invariants and add adversarial truth-negation tests.',
    );
  }

  if (input.breakVsRepairFrontiers.length > 0) {
    nextProbes.push(
      `Investigate ${input.breakVsRepairFrontiers.length} break-vs-repair frontier transitions and retain the smallest counterexample traces.`,
    );
  }

  if (nextProbes.length === 0) {
    nextProbes.push('Current deltas are stable; freeze this suite as a regression baseline.');
  }

  return {
    tightenVsWaste,
    breakVsRepair,
    truthMinVsTruthMax,
    breakVsRepairFrontiers: input.breakVsRepairFrontiers,
    nextProbes,
  };
}

export async function runBoundaryLearningSuite<State>(
  config: BoundaryLearningSuiteConfig<State>,
): Promise<BoundaryLearningReport<State>> {
  const checker = config.checker ?? new ForkRaceFoldModelChecker<State>();
  const baseOptions = config.baseOptions ?? {};

  const tightenVsWaste = await runInversionCheck(
    config.model,
    config.suite.tightenVsWaste,
    baseOptions,
    checker,
  );

  const breakVsRepair = await runInversionCheck(
    config.model,
    config.suite.breakVsRepair,
    baseOptions,
    checker,
  );

  const truthMinVsTruthMax = await runInversionCheck(
    config.model,
    config.suite.truthMinVsTruthMax,
    baseOptions,
    checker,
  );

  const breakVsRepairSweepConfig = {
    model: config.model,
    pair: config.suite.breakVsRepair,
    depth: config.depth,
    pressure: config.pressure,
    checker,
    baseOptions,
    ...(config.pressureToOptions
      ? { pressureToOptions: config.pressureToOptions }
      : {}),
  } satisfies BoundarySweepConfig<State>;

  const breakVsRepairSweep = await runBoundarySweep(breakVsRepairSweepConfig);

  return composeBoundaryLearningReport({
    tightenVsWaste,
    breakVsRepair,
    truthMinVsTruthMax,
    breakVsRepairFrontiers: breakVsRepairSweep.frontiers,
  });
}
