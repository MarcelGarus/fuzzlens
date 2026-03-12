import * as vscode from 'vscode';
import * as path from 'path';

import { removeFromStateOnceExited, spawnFuzzLensProcess, writeProcessOutputToState } from '../services/fuzzer';
import { ProcessState } from '../types/state';
import { FuzzLensContext } from '../types/context';
import { getFunctionAtPosition } from '../services/symbols';
import { WHOLE_FILE_KEY } from '../config/languages';

export default (ctx: FuzzLensContext) => async () => {
    try {
        if (ctx.state.runningProcesses.size > 0) {
            vscode.window.showWarningMessage('Fuzzer already running. Stop it first.');
            return;
        }
        // Get the content of the current active editor
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor. Open a file to pass its content to the fuzzer.');
            return;
        }
        const file = editor.document.fileName;
        console.log(file);

        // Try to determine the function name at the cursor position
        const cursorPosition = editor.selection.active;
        const functionAtCursor = await getFunctionAtPosition(editor.document, cursorPosition);
        const functionName = functionAtCursor?.name || WHOLE_FILE_KEY;

        const process = spawnFuzzLensProcess({
            extensionPath: ctx.vscode.extensionPath,
            file,
            functionName: functionName === WHOLE_FILE_KEY ? undefined : functionName
        });

        const processState: ProcessState = {
            process,
            file,
            functionName,
            startedAt: Date.now()
        };
        ctx.state.runningProcesses.set(`${file}:${functionName}`, processState);

        // Show loading indicator with file name
        const fileName = path.basename(file);
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `FuzzLens: Fuzzing ${functionName === WHOLE_FILE_KEY ? fileName : `${functionName} in ${fileName}`}...`,
            cancellable: true
        }, async (progress, token) => {
            token.onCancellationRequested(() => {
                if (process.pid) {
                    process.kill();
                    ctx.state.runningProcesses.delete(`${file}:${functionName}`);
                }
            });

            return new Promise<void>((resolve) => {
                process.on('exit', (code) => {
                    if (code !== 0) {
                        vscode.window.showErrorMessage(`FuzzLens: Fuzzer failed (exit code ${code})`);
                    }
                    resolve();
                });
            });
        });

        removeFromStateOnceExited(processState, ctx.state);
        writeProcessOutputToState(ctx, processState); // -> onFuzzerResultsReady event
    } catch (error) {
        vscode.window.showErrorMessage(`Error running fuzzer on current file: ${(error as Error).message}`);
    }
};
