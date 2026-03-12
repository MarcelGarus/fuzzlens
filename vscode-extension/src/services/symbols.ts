import * as vscode from 'vscode';
import { WHOLE_FILE_KEY } from '../config/languages';
import { FunctionInfo } from '../types/state';

export class FunctionNotFoundError extends Error {
    constructor(
        public readonly functionName: string,
        public readonly filePath: string
    ) {
        super(`Function '${functionName}' not found in ${filePath}`);
        this.name = 'FunctionNotFoundError';
    }
}

/**
 * Get function symbols from a document using VS Code's built-in LSP.
 * This uses the language server for Python/JavaScript to find functions.
 * 
 * Line numbers are 0-based, consistent with VS Code's Position API.
 */
export async function getFunctionSymbols(document: vscode.TextDocument): Promise<FunctionSymbol[]> {
    try {
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider',
            document.uri
        );

        if (!symbols) {
            return [];
        }

        return extractFunctionSymbols(symbols, document.uri.fsPath);
    } catch (error) {
        console.error('Error getting document symbols:', error);
        return [];
    }
}

export interface FunctionSymbol {
    name: string;
    filePath: string;
    line: number;  // 0-based line number
    range: vscode.Range;
    selectionRange: vscode.Range;
}

function extractFunctionSymbols(symbols: vscode.DocumentSymbol[], filePath: string): FunctionSymbol[] {
    const functions: FunctionSymbol[] = [];

    for (const symbol of symbols) {
        if (symbol.kind === vscode.SymbolKind.Function || 
            symbol.kind === vscode.SymbolKind.Method) {
            functions.push({
                name: symbol.name,
                filePath,
                line: symbol.selectionRange.start.line,
                range: symbol.range,
                selectionRange: symbol.selectionRange,
            });
        }

        // Recursively search children (for nested functions, class methods, etc.)
        if (symbol.children && symbol.children.length > 0) {
            functions.push(...extractFunctionSymbols(symbol.children, filePath));
        }
    }

    return functions;
}

/**
 * Find a function by name in a document.
 * Returns undefined if the function no longer exists (e.g., was deleted).
 */
export async function findFunctionByName(
    document: vscode.TextDocument, 
    functionName: string
): Promise<FunctionSymbol | undefined> {
    const symbols = await getFunctionSymbols(document);
    return symbols.find(s => s.name === functionName);
}

/**
 * Find all function symbols in a file by path.
 */
export async function getFunctionsInFile(filePath: string): Promise<FunctionSymbol[]> {
    try {
        const uri = vscode.Uri.file(filePath);
        const document = await vscode.workspace.openTextDocument(uri);
        return getFunctionSymbols(document);
    } catch (error) {
        console.error(`Error getting functions in file ${filePath}:`, error);
        return [];
    }
}

/**
 * Get the line number (0-based) of a function in a document.
 * 
 * @param document The document to search
 * @param functionName The function name to find
 * @returns 0-based line number, or undefined if not found
 */
export async function getFunctionLine(
    document: vscode.TextDocument,
    functionName: string
): Promise<number | undefined> {
    const fn = await findFunctionByName(document, functionName);
    return fn?.line;
}

/**
 * Special return value indicating the last line of the file should be used.
 * Used when function name is WHOLE_FILE_KEY.
 */
export const LAST_LINE_MARKER = -1;

/**
 * Get the line number (0-based) of a function by file path and function name.
 * 
 * For special key WHOLE_FILE_KEY, returns LAST_LINE_MARKER (-1).
 * 
 * @param filePath Path to the file
 * @param functionName Function name to find
 * @throws FunctionNotFoundError if function doesn't exist and is not a special key
 * @returns 0-based line number, or LAST_LINE_MARKER for whole-file/unknown
 */
export async function getFunctionLineByPath(
    filePath: string,
    functionName: string
): Promise<number> {
    // Handle special keys - return marker for last line
    if (functionName === WHOLE_FILE_KEY) {
        return LAST_LINE_MARKER;
    }

    try {
        const uri = vscode.Uri.file(filePath);
        const document = await vscode.workspace.openTextDocument(uri);
        const line = await getFunctionLine(document, functionName);
        
        if (line === undefined) {
            throw new FunctionNotFoundError(functionName, filePath);
        }
        
        return line;
    } catch (error) {
        if (error instanceof FunctionNotFoundError) {
            throw error;
        }
        console.error(`Error getting function line for ${functionName} in ${filePath}:`, error);
        throw new FunctionNotFoundError(functionName, filePath);
    }
}

/**
 * Resolve a line number, handling LAST_LINE_MARKER.
 * 
 * @param line The line number (0-based) or LAST_LINE_MARKER
 * @param document The document to get line count from
 * @returns Resolved 0-based line number
 */
export function resolveLineNumber(line: number, document: vscode.TextDocument): number {
    if (line === LAST_LINE_MARKER) {
        return Math.max(0, document.lineCount - 1);
    }
    return line;
}

export async function getFunctionAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position
): Promise<FunctionSymbol | undefined> {
    const symbols = await getFunctionSymbols(document);
    
    // Find the smallest function that contains this position
    let bestMatch: FunctionSymbol | undefined;
    
    for (const fn of symbols) {
        if (fn.range.contains(position)) {
            if (!bestMatch || fn.range.start.isAfter(bestMatch.range.start)) {
                bestMatch = fn;
            }
        }
    }
    
    return bestMatch;
}
export async function discoverFunctionsInFile(filePath: string): Promise<FunctionInfo[]> {
    const symbols = await getFunctionsInFile(filePath);
    
    return symbols.map(sym => ({
        name: sym.name,
        filePath: sym.filePath,
        line: sym.line,
        status: 'not-run' as const,
        runCount: 0,
    }));
}
