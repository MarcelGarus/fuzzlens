import * as vscode from 'vscode';
import * as path from 'path';

import { removeFromStateOnceExited, spawnFuzzLensProcess, writeProcessOutputToState } from '../services/fuzzer';
import { ProcessState, FunctionInfo } from '../types/state';
import { FuzzLensContext } from '../types/context';
import { FunctionItem } from '../fuzzlens/treeView';

/**
 * Run the fuzzer on a specific function (from tree view context menu).
 * This is different from runFuzzerOnCurrentFile which runs on the cursor position.
 * 
 * Can receive either a FunctionInfo directly or a FunctionItem from the tree view.
 */
export default (ctx: FuzzLensContext) => async (arg?: FunctionInfo | FunctionItem) => {
    // Extract FunctionInfo from argument (could be FunctionItem from tree context menu)
    let functionInfo: FunctionInfo | undefined;
    if (arg instanceof FunctionItem) {
        functionInfo = arg.info;
    } else {
        functionInfo = arg;
    }

    if (!functionInfo) {
        vscode.window.showErrorMessage('No function specified. Select a function from the tree view.');
        return;
    }

    if (!functionInfo.filePath) {
        vscode.window.showErrorMessage('Function has no associated file path.');
        return;
    }

    await vscode.commands.executeCommand('fuzzlens.selectFunction', functionInfo);

    console.log(`Running fuzzer on function: ${functionInfo.name} in file: ${functionInfo.filePath}`);

    const file = functionInfo.filePath;
    const functionName = functionInfo.name;

    try {
        // Check if already running
        const key = `${file}:${functionName}`;
        if (ctx.state.runningProcesses.has(key)) {
            vscode.window.showWarningMessage(`Fuzzer already running for ${functionName}. Stop it first.`);
            return;
        }

        // Update tree status to running immediately
        ctx.providers.functionsTree.updateFunctionStatus(file, functionName, 'running');

        const process = spawnFuzzLensProcess({
            extensionPath: ctx.vscode.extensionPath,
            file,
            functionName
        });

        const processState: ProcessState = {
            process,
            file,
            functionName,
            startedAt: Date.now()
        };
        ctx.state.runningProcesses.set(key, processState);

        // Select this function in the results tree
        ctx.providers.resultsTree.setCurrentFunction(functionInfo);

        // Show loading indicator with file name
        const fileName = path.basename(file);
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `FuzzLens: Fuzzing ${functionName} in ${fileName}...`,
            cancellable: true
        }, async (progress, token) => {
            token.onCancellationRequested(() => {
                if (process.pid) {
                    process.kill();
                    ctx.state.runningProcesses.delete(key);
                    ctx.providers.functionsTree.updateFunctionStatus(file, functionName, 'not-run');
                }
            });

            return new Promise<void>((resolve) => {
                process.on('exit', (code) => {
                    if (code !== 0) {
                        vscode.window.showErrorMessage(`FuzzLens: Fuzzer failed for ${functionName} (exit code ${code})`);
                        ctx.providers.functionsTree.updateFunctionStatus(file, functionName, 'not-run');
                    }
                    resolve();
                });
            });
        });

        removeFromStateOnceExited(processState, ctx.state);
        writeProcessOutputToState(ctx, processState); // -> onFuzzerResultsReady event
    } catch (error) {
        vscode.window.showErrorMessage(`Error running fuzzer: ${(error as Error).message}`);
    }
};
