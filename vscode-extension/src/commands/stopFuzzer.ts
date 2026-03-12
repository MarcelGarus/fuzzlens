import * as vscode from 'vscode';

import { cleanup } from '../services/fuzzer';
import { FuzzLensContext } from '../types/context';

export default (ctx: FuzzLensContext) => async () => {
    try {
        if (ctx.state.runningProcesses.size > 0) {
            cleanup(ctx.state);
            vscode.window.showInformationMessage('Fuzzer process terminated.');
        } else {
            vscode.window.showInformationMessage('No active fuzzer process.');
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Error while stopping fuzzer: ${(error as Error).message}`);
    }
};
