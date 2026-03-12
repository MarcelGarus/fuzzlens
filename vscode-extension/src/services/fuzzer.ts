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
    args = ['--file', `"${file}"`, '--no-color', ...args];

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

export const writeProcessOutputToState = (ctx: FuzzLensContext, processState: ProcessState) => {
    const process = processState.process;
    if (!process) {
        throw new Error('No process found in process state.');
    }

    let stdout = '';
    // once the process exits, we resolve the promises
    processState.stdout = new Promise<string>((resolve) => {
        process.on('exit', () => {
            resolve(stdout);
        });
    });
    process.stdout.setEncoding('utf8');
    process.stdout.on('data', (d: string) => {
        stdout += d;
    });

    createFuzzerResultsOnceExited(ctx, processState);

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

const createFuzzerResultsOnceExited = async (ctx: FuzzLensContext, processState: ProcessState) => {
    if (!processState.stdout) {
        vscode.window.showErrorMessage('No stdout promise found in process state.');
        return;
    }

    try {
        const data = await processState.stdout;
        const { runs, analyses } = parseFuzzerOutput(data);

        processState.results = Promise.resolve(runs);
        processState.analyses = analyses;

        if (processState.file) {
            const cache = getCache();
            const functionName = processState.functionName;
            cache.set(processState.file, functionName, {
                runs,
                analyses,
                timestamp: Date.now()
            });
        }

        ctx.events.onFuzzerResultsReady.fire(processState);
    } catch (err) {
        ctx.output.appendLine(`Error parsing fuzzer output: ${(err as Error).message}`);
        ctx.output.show(true);
        vscode.window.showErrorMessage(`Error parsing fuzzer output: ${(err as Error).message}`);
        return;
    }
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
