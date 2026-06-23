import * as vscode from 'vscode';
import { ProcessState, FuzzerState, ResultGroup, FuzzRunHandle } from '../types/state';
import { FuzzLensContext } from '../types/context';
import { getCache } from './cache';
import { getGraalLanguageForFile } from '../config/languages';
import { FuzzDaemon } from './fuzzDaemon';

export const FUZZLENS_QUERIES = [
    // Hover provider queries
    'observedSignature',          // Main signature display (input types → output types)
    'inputShapeOutputTypeTable',  // Compact type mapping table
    'exceptionExamples',          // Exception breakdown with counts
    'validExamples',              // One example per type pair
    // Tree view panel
    'treeList',
    // Inline examples
    'relevantPairs',
    // Inline "input → output" next to each return statement (curated server-side)
    'returnExamples',
];

export interface FuzzRunOptions {
    extensionPath: string;
    file: string;
    functionName?: string;
    iterations?: number;
    queries?: string[];
    /**
     * Source code to fuzz directly instead of reading `file` from disk. Lets us
     * fuzz the live (possibly unsaved) editor buffer. The `file` is still used to
     * derive the language and as the cache/state key.
     */
    code?: string;
    /** GraalVM language id (e.g. 'python', 'js'). Derived from `file` if omitted. */
    language?: string;
}

/**
 * Start one fuzzing run on the warm daemon and return its typed handle. The
 * daemon keeps the GraalVM engine warm, so each run costs ~100ms instead of a
 * cold ~3s JVM spawn.
 */
export const startFuzzRun = (options: FuzzRunOptions): FuzzRunHandle => {
    const { extensionPath, file, functionName, code, language, iterations = 1000, queries = FUZZLENS_QUERIES } = options;
    const lang = language ?? getGraalLanguageForFile(file) ?? 'python';
    return FuzzDaemon.get(extensionPath).submit({
        language: lang,
        code,
        file,
        function: functionName,
        iterations,
        queries,
    });
};

/**
 * Minimum time between throttled `onFuzzerProgress` events while runs stream in,
 * so a fast fuzzing loop doesn't thrash the UI with a refresh per iteration.
 * Kept short, with a leading-edge first emit, so that even sub-second fuzzing
 * runs produce a few visible incremental updates rather than one final batch.
 */
const PROGRESS_THROTTLE_MS = 120;

/**
 * Wire a run's snapshot stream into its process state.
 *
 * The daemon emits curated snapshots — a progress count followed by the analysis
 * results (including `returnExamples`) — periodically as the run improves, rather
 * than one line per individual run. We store the latest snapshot, keep the cache
 * current, and fire `onFuzzerProgress` (throttled, since a snapshot is a burst of
 * lines) so the UI updates live. `onFuzzerResultsReady` fires once at the end.
 */
export const streamRunIntoState = (
    ctx: FuzzLensContext,
    processState: ProcessState,
    options?: { showErrors?: boolean }
) => {
    const handle = processState.handle;
    if (!handle) {
        throw new Error('No fuzz run handle in process state.');
    }

    // Auto-triggered runs (on-view, on-edit) pass showErrors=false so transient
    // failures (e.g. fuzzing half-typed, syntactically-invalid code) don't pop
    // the output panel.
    const showErrors = options?.showErrors ?? true;

    const analyses = new Map<string, ResultGroup>();
    processState.analyses = analyses;
    processState.runCount = 0;

    // Timing milestones, so the output channel shows where the wall-clock goes:
    // start → first snapshot (engine/queue latency) → finish (total).
    const label = processState.functionName || 'file';
    const startedAt = processState.startedAt ?? Date.now();
    let firstSnapshotLogged = false;
    ctx.output.appendLine(`[${label}] started fuzzing`);

    let lastProgressAt = 0;

    // Push the latest snapshot into the cache and notify listeners.
    const commit = (final: boolean) => {
        // A run cancelled mid-flight (e.g. superseded by a fresh edit) must not
        // write its now-stale snapshot over the newer run's.
        if (processState.cancelled) {
            return;
        }

        if (processState.file) {
            getCache().set(processState.file, processState.functionName, {
                analyses: new Map(analyses),
                runCount: processState.runCount ?? 0,
                timestamp: Date.now()
            });
        }

        if (final) {
            ctx.events.onFuzzerResultsReady.fire(processState);
        } else {
            lastProgressAt = Date.now();
            ctx.events.onFuzzerProgress.fire(processState);
        }
    };

    // Throttle progress events: at most one per PROGRESS_THROTTLE_MS. Each daemon
    // snapshot is a burst of lines (progress + several analyses) that arrive back
    // to back, so the throttle coalesces a burst into a single UI refresh.
    let progressTimer: NodeJS.Timeout | undefined;
    let progressPending = false;
    const scheduleProgress = () => {
        progressPending = true;
        if (progressTimer) { return; }
        const sinceLast = Date.now() - lastProgressAt;
        const delay = sinceLast >= PROGRESS_THROTTLE_MS ? 0 : PROGRESS_THROTTLE_MS - sinceLast;
        progressTimer = setTimeout(() => {
            progressTimer = undefined;
            if (progressPending && !processState.cancelled) {
                progressPending = false;
                commit(false);
            }
        }, delay);
    };
    const cancelScheduledProgress = () => {
        if (progressTimer) {
            clearTimeout(progressTimer);
            progressTimer = undefined;
        }
        progressPending = false;
    };

    const noteFirstSnapshot = () => {
        if (!firstSnapshotLogged) {
            firstSnapshotLogged = true;
            ctx.output.appendLine(`[${label}] first snapshot after ${Date.now() - startedAt}ms`);
        }
    };

    handle.onProgress((count) => {
        noteFirstSnapshot();
        processState.runCount = count;
        scheduleProgress();
    });

    handle.onAnalysis((query, root) => {
        noteFirstSnapshot();
        analyses.set(query, root);
        scheduleProgress();
    });

    handle.onDone((code, errorMessage) => {
        cancelScheduledProgress();
        const elapsed = Date.now() - startedAt;
        if (processState.cancelled) {
            ctx.output.appendLine(`[${label}] cancelled after ${elapsed}ms (superseded by a newer edit)`);
        } else if (code !== 0) {
            ctx.output.appendLine(`[${label}] failed after ${elapsed}ms${errorMessage ? ': ' + errorMessage : ''}`);
            if (showErrors) {
                ctx.output.show(true); // Surface the output channel on error
            }
        } else {
            ctx.output.appendLine(`[${label}] finished: ${processState.runCount ?? 0} results in ${elapsed}ms`);
        }
        commit(true);
    });
};

export const removeFromStateOnceExited = (processState: ProcessState, state: FuzzerState) => {
    const handle = processState.handle;
    if (!handle) {
        throw new Error('No fuzz run handle in process state.');
    }
    handle.onDone(() => {
        if (processState.file && processState.functionName) {
            const key = `${processState.file}:${processState.functionName}`;
            // Only clear our own entry — a newer run may have replaced us under
            // the same key (e.g. after an edit superseded this run).
            if (state.runningProcesses.get(key) === processState) {
                state.runningProcesses.delete(key);
            }
        }
    });
};

export const cleanup = (state: FuzzerState) => {
    for (const processState of state.runningProcesses.values()) {
        cancelFuzzRun(processState);
    }
    state.runningProcesses.clear();
};

const cancelFuzzRun = (processState: ProcessState) => {
    try {
        processState.cancelled = true;
        processState.handle?.cancel();
    } catch (e) {
        vscode.window.showErrorMessage(`Error cancelling fuzzer run: ${(e as Error).message}`);
    }
};
