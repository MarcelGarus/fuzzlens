// === State Management ===

export interface FuzzerState {
    /** Map from "filePath:functionName" to running process state */
    runningProcesses: Map<string, ProcessState>;
    inlineExamples: InlineExamplesState;
}

export const createState = (): FuzzerState => ({
    runningProcesses: new Map(),
    inlineExamples: createInlineExamplesState(),
});

// === Process State ===

/**
 * A handle to one fuzzing run on the daemon. The daemon streams typed results
 * through the callbacks; `cancel()` aborts the run (e.g. superseded by an edit).
 * Each `on*` may be called more than once to register multiple subscribers.
 */
export interface FuzzRunHandle {
    /** Fired with the running count of results produced so far. */
    onProgress(cb: (count: number) => void): void;
    /** Fired for each curated analysis snapshot (improving over the run). */
    onAnalysis(cb: (query: string, root: ResultGroup) => void): void;
    /** Fired exactly once when the run ends: code 0 on success, non-zero on failure. */
    onDone(cb: (code: number, errorMessage?: string) => void): void;
    /** Abort the run. */
    cancel(): void;
}

/** Full state for a running or completed fuzzer execution. */
export interface ProcessState {
    file: string;
    functionName: string;
    handle?: FuzzRunHandle;
    startedAt: number;
    /** Number of runs the daemon has produced so far (from progress snapshots). */
    runCount?: number;
    /** Curated behavior snapshots, keyed by query name (incl. `returnExamples`). */
    analyses?: Map<string, ResultGroup>;
    /** Set when a run is superseded (e.g. by a newer edit) so it stops writing results. */
    cancelled?: boolean;
}

// === Fuzzer Output Types ===
// All types mirror Java classes used in GraalFuzz fuzzer output

/** Union type for all JSONL output lines. */
export type FuzzerOutput = RunResult | AnalysisOutput;

/** Individual run result (type: "run") */
export interface RunResult {
    type: "run";
    universe: Universe;
    input: Value;
    didCrash: boolean;
    outputType: "Normal" | "Crash";
    typeName?: string;
    value?: string;
    message?: string;
    stackTrace?: string[];
    trace: Trace;
    /** 1-based source lines of the fuzzed code this run executed (user code only). */
    coveredLines?: number[];
}

/** Analysis query result (type: "analysis") */
export interface AnalysisOutput {
    type: "analysis";
    query?: string;
    root: ResultGroup;
}

/** A group from query results */
export interface ResultGroup {
    /** Display label for the group (Java produces a ready-to-show string). */
    key: string;
    samples?: RunResultInGroup[];
    children?: ResultGroup[];
    aggregations?: Record<string, unknown>;
}

/** Sample in Group Run Result */
export interface RunResultInGroup {
    universe: Universe;
    input: Value;
    didCrash: boolean;
    outputType: "Normal" | "Crash";
    typeName?: string;
    value?: string;
    message?: string;
    stackTrace?: string[];
    trace: Trace;
}

// === Group Keys ===
// Matches Java GroupKeyAdapter serialization format

export type GroupKey = RootKey | SingleKey | CompositeKey;

export interface RootKey {
    type: "Root";
}

export interface SingleKey {
    type: "Single";
    column: string;
    value: unknown; // Can be Shape, string, number, array, etc.
}

export interface CompositeKey {
    type: "Composite";
    parts: KeyPart[];
}

/** A part of a composite key - has column name and value */
export interface KeyPart {
    column: string;
    value: unknown; // Can be Shape, string, number, array, etc.
}

// Shape with proper discriminated union matching Java serialization
export type Shape =
    | { type: "Null" }
    | { type: "Boolean" }
    | { type: "Int" }
    | { type: "Double" }
    | { type: "String" }
    | { type: "Object"; members: Record<string, Shape> };

// Legacy ShapeValue interface for backwards compatibility
export interface ShapeValue {
    id?: { value: number };
    universe?: Universe;
}

// === Universe & Values ===

export interface Universe {
    objects: Record<string, ObjectDefinition>;
}

export interface ObjectDefinition {
    members: Record<string, Value>;
}

export interface Trace {
    entries: TraceEntry[];
}

export type TraceEntry =
    | { type: "Call"; arg: Partial<Omit<Value, "type">> }
    | { type: "QueryMember"; id: { value: number }; key: string }
    | { type: "Member"; id: { value: number }; key: string; value?: Partial<Omit<Value, "type">> }
    | { type: "Return"; typeName: string; value: string }
    | { type: "Crash"; message: string };

export type Value =
    | { type: "Null" }
    | { type: "Boolean"; value: boolean }
    | { type: "Int"; value: number }
    | { type: "Double"; value: number }
    | { type: "String"; value: string }
    | { type: "Object"; id: { value: number } };

// === Cache Types ===

export interface CachedResults {
    /** Number of runs the snapshot was computed from. */
    runCount?: number;
    analyses: Map<string, ResultGroup>;
    timestamp: number;
    /** @deprecated Raw runs are no longer streamed to the client; kept for back-compat. */
    runs?: RunResult[];
}

export interface FunctionInfo {
    name: string;
    filePath: string;
    status: "not-run" | "has-results" | "outdated" | "running";
    runCount?: number;
}

// === Inline Examples State ===
interface InlineExampleState {
    filePath: string;
    functionName: string;
    line: number;
    examples: string[];
    currentIndex: number;
}

export interface InlineExamplesState {
    examples: Map<string, InlineExampleState>;
    rotationInterval: NodeJS.Timeout | undefined;
    isPaused: boolean;
    /** Files whose examples are greyed out pending re-fuzzing; rotation skips them. */
    pendingFiles: Set<string>;
}

export function createInlineExamplesState(): InlineExamplesState {
    return {
        examples: new Map(),
        rotationInterval: undefined,
        isPaused: false,
        pendingFiles: new Set(),
    };
}
