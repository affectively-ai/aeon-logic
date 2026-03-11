import type { TraceStep } from './types.js';

export interface TlcTraceState {
  readonly index: number;
  readonly label: string;
  readonly variables: Readonly<Record<string, string>>;
}

export interface TlcJsonTrace {
  readonly format: 'tlc-trace/v1';
  readonly states: readonly TlcTraceState[];
}

export function toTlaValue(value: unknown): string {
  if (value === null) {
    return 'NULL';
  }

  if (value === undefined) {
    return 'UNDEFINED';
  }

  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? `${value}` : JSON.stringify(value);
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `<<${value.map((entry) => toTlaValue(entry)).join(', ')}>>`;
  }

  if (value instanceof Set) {
    const setEntries = [...value].map((entry) => toTlaValue(entry)).sort();
    return `{${setEntries.join(', ')}}`;
  }

  if (value instanceof Map) {
    const entries = [...value.entries()]
      .map(([mapKey, mapValue]) => ({
        key: toTlaValue(mapKey),
        value: toTlaValue(mapValue),
      }))
      .sort((left, right) => left.key.localeCompare(right.key));
    return `[${entries.map((entry) => `${entry.key} |-> ${entry.value}`).join(', ')}]`;
  }

  if (typeof value === 'object') {
    const plainObject = value as Record<string, unknown>;
    const keys = Object.keys(plainObject).sort();
    return `[${keys
      .map((key) => `${key} |-> ${toTlaValue(plainObject[key])}`)
      .join(', ')}]`;
  }

  return JSON.stringify(String(value));
}

function formatStateVariables(
  variables: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const formatted: Record<string, string> = {};
  for (const variableName of Object.keys(variables).sort()) {
    formatted[variableName] = toTlaValue(variables[variableName]);
  }
  return formatted;
}

export function checkerTraceToTlcJson<State>(
  trace: readonly TraceStep<State>[],
  stateToVariables: (state: Readonly<State>) => Readonly<Record<string, unknown>>,
): TlcJsonTrace {
  return {
    format: 'tlc-trace/v1',
    states: trace.map((step, index) => ({
      index: index + 1,
      label: step.viaAction ?? 'Initial predicate',
      variables: formatStateVariables(stateToVariables(step.state)),
    })),
  };
}

export function checkerTraceToTlcText<State>(
  trace: readonly TraceStep<State>[],
  stateToVariables: (state: Readonly<State>) => Readonly<Record<string, unknown>>,
): string {
  const jsonTrace = checkerTraceToTlcJson(trace, stateToVariables);
  const lines: string[] = [];

  for (const state of jsonTrace.states) {
    lines.push(`State ${state.index}: <${state.label}>`);
    for (const variableName of Object.keys(state.variables).sort()) {
      const value = state.variables[variableName];
      lines.push(`/\\ ${variableName} = ${value}`);
    }
  }

  return lines.join('\n');
}

export function parseTlcTextTrace(traceText: string): TlcJsonTrace {
  const states: TlcTraceState[] = [];
  const lines = traceText.replace(/\r/g, '').split('\n');

  let currentState:
    | {
        index: number;
        label: string;
        variables: Record<string, string>;
      }
    | undefined;
  let lastVariableName: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }

    const stateMatch = /^State\s+(\d+):\s*<(.*)>$/.exec(line);
    if (stateMatch) {
      const stateIndex = stateMatch[1];
      const stateLabel = stateMatch[2];
      if (!stateIndex || stateLabel === undefined) {
        continue;
      }

      if (currentState) {
        states.push({
          index: currentState.index,
          label: currentState.label,
          variables: currentState.variables,
        });
      }

      currentState = {
        index: Number.parseInt(stateIndex, 10),
        label: stateLabel,
        variables: {},
      };
      lastVariableName = null;
      continue;
    }

    if (!currentState) {
      continue;
    }

    const assignmentMatch = /^\/\\\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (assignmentMatch) {
      const variableName = assignmentMatch[1];
      const variableValue = assignmentMatch[2];
      if (!variableName || variableValue === undefined) {
        continue;
      }

      currentState.variables[variableName] = variableValue;
      lastVariableName = variableName;
      continue;
    }

    if (lastVariableName) {
      currentState.variables[lastVariableName] =
        `${currentState.variables[lastVariableName]} ${line}`.trim();
    }
  }

  if (currentState) {
    states.push({
      index: currentState.index,
      label: currentState.label,
      variables: currentState.variables,
    });
  }

  return {
    format: 'tlc-trace/v1',
    states,
  };
}
