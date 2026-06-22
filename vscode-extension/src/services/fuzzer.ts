import * as vscode from 'vscode';
import { ProcessState, FuzzerState, RunResult, ResultGroup, FuzzRunHandle } from '../types/state';
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
 * Accumulate a run's streamed results into its process state.
 *
 * The daemon streams typed `run` results as they're produced and `analysis`
 * results at the end. We accumulate them, keep the cache up to date, and fire
 * `onFuzzerProgress` (throttled for runs, immediately for analyses) so the UI
 * updates live. `onFuzzerResultsReady` fires once when the run finishes.
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

    const runs: RunResult[] = [];
    const analyses = new Map<string, ResultGroup>();
    processState.results = Promise.resolve(runs);
    processState.analyses = analyses;

    // Timing milestones, so the output channel shows where the wall-clock goes:
    // start → first result (engine/queue latency) → analysis → finish (total).
    const label = processState.functionName || 'file';
    const startedAt = processState.startedAt ?? Date.now();
    let firstRunLogged = false;
    let analysisLogged = false;
    ctx.output.appendLine(`[${label}] started fuzzing`);

    let lastProgressAt = 0;

    // Push the latest accumulated results into the cache and notify listeners.
    const commit = (final: boolean) => {
        // A run cancelled mid-flight (e.g. superseded by a fresh edit) must not
        // write its now-stale partial results over the newer run's.
        if (processState.cancelled) {
            return;
        }

        // Snapshot so consumers that read asynchronously aren't surprised by later mutation.
        processState.results = Promise.resolve(runs.slice());

        if (processState.file) {
            getCache().set(processState.file, processState.functionName, {
                runs: runs.slice(),
                analyses: new Map(analyses),
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

    // Throttle progress events: at most one per PROGRESS_THROTTLE_MS, but emit the
    // first one immediately (leading edge) so streaming is visible even when the
    // whole run finishes within one throttle window.
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

    handle.onRun((run) => {
        if (!firstRunLogged) {
            firstRunLogged = true;
            ctx.output.appendLine(`[${label}] first result after ${Date.now() - startedAt}ms`);
        }
        runs.push(run);
        scheduleProgress();
    });

    handle.onAnalysis((query, root) => {
        if (!analysisLogged) {
            analysisLogged = true;
            ctx.output.appendLine(`[${label}] analysis ready after ${Date.now() - startedAt}ms`);
        }
        analyses.set(query, root);
        // Analyses (signatures, grouped views, inline examples) are high-value —
        // surface them immediately rather than waiting for the next throttle tick.
        cancelScheduledProgress();
        commit(false);
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
            ctx.output.appendLine(`[${label}] finished: ${runs.length} results in ${elapsed}ms`);
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
