import * as vscode from 'vscode';
import { ProcessState, FunctionInfo } from './state';

/**
 * Interface for the Functions tree provider.
 * Shows workspace files and discovered functions in explorer style.
 */
export interface FunctionsTreeProvider extends vscode.TreeDataProvider<unknown> {
    refresh(): void;
    setDiscoveredFunctions(filePath: string, functions: FunctionInfo[]): void;
    updateFunctionStatus(
        filePath: string, 
        functionName: string, 
        status: FunctionInfo['status'], 
        runCount?: number
    ): void;
    revealFile(filePath: string): void;
}

/**
 * Interface for the Results tree provider.
 * Shows fuzzing results for the selected function.
 */
export interface ResultsTreeProvider extends vscode.TreeDataProvider<unknown> {
    refresh(): void;
    setResults(state: ProcessState): void;
    setCurrentFunction(fn: FunctionInfo | undefined): void;
}

/**
 * Container for tree providers, typed properly.
 */
export interface TreeProviders {
    functionsTree: FunctionsTreeProvider;
    resultsTree: ResultsTreeProvider;
}
