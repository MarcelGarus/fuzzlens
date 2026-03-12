import * as vscode from "vscode";
import { createState, ProcessState, FuzzerState } from "./state";
import { TreeProviders } from "./providers";

export interface FuzzLensContext {
    vscode: vscode.ExtensionContext;
    output: vscode.OutputChannel;
    state: FuzzerState;
    events: FuzzLensEvents;
    providers: TreeProviders;
}

export interface FuzzLensEvents {
    onFuzzerResultsReady: vscode.EventEmitter<ProcessState>;
    onInlineExamplesToggled: vscode.EventEmitter<boolean>;
    onFunctionSelected: vscode.EventEmitter<{ filePath: string; functionName: string }>;
}

export const createContext = ({ context, providers }: { context: vscode.ExtensionContext; providers: TreeProviders }): FuzzLensContext => ({
    vscode: context,
    output: vscode.window.createOutputChannel('FuzzLens'),
    state: createState(),
    events: {
        onFuzzerResultsReady: new vscode.EventEmitter<ProcessState>(),
        onInlineExamplesToggled: new vscode.EventEmitter<boolean>(),
        onFunctionSelected: new vscode.EventEmitter<{ filePath: string; functionName: string }>(),
    },
    providers,
});
