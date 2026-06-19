import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { ProcessState, FuzzerState, FuzzerOutput, RunResult, ResultGroup } from '../types/state';
import * as fs from 'fs';
import { FuzzLensContext } from '../types/context';
import { getCache } from './cache';

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

export interface FuzzLensProcessOptions {
    extensionPath: string;
    file: string;
    functionName?: string;
    iterations?: number;
    queries?: string[];
    toJSON?: boolean;
}

export const spawnGraalFuzzProcess = (extensionPath: string, file: string, toJSON: boolean = true, args: string[] = []): ChildProcessWithoutNullStreams => {
    // TODO: Before publishing, move the platform specific native builds into the extension directory. Part of distribution when published.
    // Choose script based on platform
    const isWin = process.platform === 'win32';
    const script = isWin
        ? path.join(extensionPath, '..', 'graalfuzz.cmd')
        : path.join(extensionPath, '..', 'graalfuzz.sh');
    args = ['--file', `${file}`, '--no-color', ...args];

    if (toJSON) {
        args.push('--tooling');
    }

    console.log(`Spawning GraalFuzz process: ${script} ${args.join(' ')}`);
    return spawn(script, args, { stdio: 'pipe', shell: isWin, cwd: path.join(extensionPath, '..') });
};

export const spawnFuzzerProcess = (extensionPath: string, file: string, functionName?: string, toJSON: boolean = true): ChildProcessWithoutNullStreams => {
    const args: string[] = [];
    if (functionName) {
        args.push('--function', functionName);
    }
    return spawnGraalFuzzProcess(extensionPath, file, toJSON, args);
};

export const spawnFuzzLensProcess = (options: FuzzLensProcessOptions): ChildProcessWithoutNullStreams => {
    const { extensionPath, file, functionName, iterations = 1000, queries = FUZZLENS_QUERIES, toJSON = true } = options;

    const args = [
        '--iterations', String(iterations),
        '--query', queries.join(',')
    ];

    if (functionName) {
        args.push('--function', functionName);
    }

    console.log(`Spawning FuzzLens process: ${args.join(' ')}`);
    return spawnGraalFuzzProcess(extensionPath, file, toJSON, args);
};

export function parseFuzzerOutput(data: string): {
    runs: RunResult[];
    analyses: Map<string, ResultGroup>;
} {
    const lines = data.trim().split('\n').filter(line => line.trim());
    const runs: RunResult[] = [];
    const analyses = new Map<string, ResultGroup>();

    for (const line of lines) {
        try {
            const parsed = JSON.parse(line) as FuzzerOutput;
            if (parsed.type === 'run') {
                runs.push(parsed);
            } else if (parsed.type === 'analysis') {
                const queryName = parsed.query || 'default';
                analyses.set(queryName, parsed.root);
            }
        } catch (err) {
            console.error('Error parsing JSONL line:', line, err);
        }
    }

    return { runs, analyses };
}

export const pipeProcessOutToVSCodeOutput = (processState: ProcessState, outputChannel: vscode.OutputChannel) => {
    const process = processState.process;
    if (!process) {
        throw new Error('No process found in process state.');
    }

    process.stdout.setEncoding('utf8');
    process.stdout.on('data', (d: string) => outputChannel.append(d));

    process.stderr.setEncoding('utf8');
    process.stderr.on('data', (d: string) => outputChannel.append('[stderr] ' + d));

    process.on('exit', code => {
        outputChannel.appendLine('\nFuzzer exited with code ' + code);
    });
};

/**
 * Minimum time between throttled `onFuzzerProgress` events while runs stream in,
 * so a fast fuzzing loop doesn't thrash the UI with a refresh per iteration.
 */
const PROGRESS_THROTTLE_MS = 300;

/**
 * Stream the fuzzer's JSONL stdout into the process state as it arrives.
 *
 * The backend prints one `run` line per iteration (flushed immediately) and the
 * `analysis` lines together at the end. We parse line-by-line, accumulate results,
 * keep the cache up to date, and fire `onFuzzerProgress` (throttled for runs,
 * immediately for analyses) so the UI updates live. `onFuzzerResultsReady` fires
 * once at the end with the final results.
 */
export const writeProcessOutputToState = (ctx: FuzzLensContext, processState: ProcessState) => {
    const process = processState.process;
    if (!process) {
        throw new Error('No process found in process state.');
    }

    const runs: RunResult[] = [];
    const analyses = new Map<string, ResultGroup>();
    processState.results = Promise.resolve(runs);
    processState.analyses = analyses;

    // Push the latest accumulated results into the cache and notify listeners.
    const commit = (final: boolean) => {
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
            ctx.events.onFuzzerProgress.fire(processState);
        }
    };

    // Throttle progress events: at most one per PROGRESS_THROTTLE_MS while runs arrive.
    let progressTimer: NodeJS.Timeout | undefined;
    let progressPending = false;
    const scheduleProgress = () => {
        progressPending = true;
        if (progressTimer) { return; }
        progressTimer = setTimeout(() => {
            progressTimer = undefined;
            if (progressPending) {
                progressPending = false;
                commit(false);
            }
        }, PROGRESS_THROTTLE_MS);
    };
    const cancelScheduledProgress = () => {
        if (progressTimer) {
            clearTimeout(progressTimer);
            progressTimer = undefined;
        }
        progressPending = false;
    };

    const handleLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) { return; }
        try {
            const parsed = JSON.parse(trimmed) as FuzzerOutput;
            if (parsed.type === 'run') {
                runs.push(parsed);
                scheduleProgress();
            } else if (parsed.type === 'analysis') {
                analyses.set(parsed.query || 'default', parsed.root);
                // Analyses (signatures, grouped views, inline examples) are
                // high-value — surface them immediately rather than waiting.
                cancelScheduledProgress();
                commit(false);
            }
        } catch (err) {
            console.error('Error parsing JSONL line:', trimmed, err);
        }
    };

    // Parse stdout line-by-line, buffering partial lines across chunks.
    let lineBuffer = '';
    let fullStdout = '';
    processState.stdout = new Promise<string>((resolve) => {
        process.on('exit', () => resolve(fullStdout));
    });
    process.stdout.setEncoding('utf8');
    process.stdout.on('data', (d: string) => {
        fullStdout += d;
        lineBuffer += d;
        let newlineIndex: number;
        while ((newlineIndex = lineBuffer.indexOf('\n')) >= 0) {
            const line = lineBuffer.slice(0, newlineIndex);
            lineBuffer = lineBuffer.slice(newlineIndex + 1);
            handleLine(line);
        }
    });

    process.on('exit', () => {
        // Flush any trailing line that wasn't newline-terminated.
        if (lineBuffer.trim()) {
            handleLine(lineBuffer);
            lineBuffer = '';
        }
        cancelScheduledProgress();
        commit(true);
    });

    let stderr = '';
    processState.stderr = new Promise<string>((resolve) => {
        process.on('exit', (code) => {
            // Log stderr to output channel if there was any
            if (stderr.trim()) {
                ctx.output.appendLine(`[${processState.functionName || 'file'}] stderr:`);
                ctx.output.appendLine(stderr);
            }
            if (code !== 0) {
                ctx.output.appendLine(`Fuzzer exited with code ${code}`);
                ctx.output.show(true); // Show output channel on error
            }
            resolve(stderr);
        });
    });
    process.stderr.setEncoding('utf8');
    process.stderr.on('data', (d: string) => {
        stderr += d;
    });
};

export const removeFromStateOnceExited = (processState: ProcessState, state: FuzzerState) => {
    if (!processState.process) {
        throw new Error('No process found in process state.');
    }
    processState.process.on('exit', () => {
        if (processState.file && processState.functionName) {
            const key = `${processState.file}:${processState.functionName}`;
            state.runningProcesses.delete(key);
        }
    });
};

export const cleanup = (state: FuzzerState) => {
    for (const processState of state.runningProcesses.values()) {
        killFuzzerProcess(processState);
    }
    state.runningProcesses.clear();
};

const killFuzzerProcess = (processState: ProcessState) => {
    try {
        processState.process?.kill?.();
    } catch (e) {
        vscode.window.showErrorMessage(`Error killing fuzzer process: ${(e as Error).message}`);
    }
};
