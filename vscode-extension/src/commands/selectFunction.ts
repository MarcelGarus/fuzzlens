import * as vscode from 'vscode';
import { FuzzLensContext } from '../types/context';
import { FunctionInfo } from '../types/state';
import { FunctionItem } from '../fuzzlens/treeView';


export default (ctx: FuzzLensContext) => async (arg: FunctionInfo | FunctionItem) => {
    // Extract FunctionInfo from argument (could be FunctionItem from tree)
    const functionInfo = arg instanceof FunctionItem ? arg.info : arg;

    if (!functionInfo?.filePath) {
        vscode.window.showErrorMessage('No function specified.');
        return;
    }

    try {
        // Open the file and navigate to function
        const document = await vscode.workspace.openTextDocument(functionInfo.filePath);
        const editor = await vscode.window.showTextDocument(document);

        // Find the function symbol to get its position
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider',
            document.uri
        );

        if (symbols) {
            const findFunctionSymbol = (syms: vscode.DocumentSymbol[]): vscode.DocumentSymbol | undefined => {
                for (const sym of syms) {
                    if ((sym.kind === vscode.SymbolKind.Function || sym.kind === vscode.SymbolKind.Method) && sym.name === functionInfo.name) {
                        return sym;
                    }
                    if (sym.children) {
                        const found = findFunctionSymbol(sym.children);
                        if (found) {
                            return found;
                        }
                    }
                }
                return undefined;
            };

            const functionSymbol = findFunctionSymbol(symbols);
            if (functionSymbol) {
                editor.selection = new vscode.Selection(functionSymbol.selectionRange.start, functionSymbol.selectionRange.start);
                editor.revealRange(functionSymbol.range, vscode.TextEditorRevealType.InCenter);
            }
        }

        ctx.providers.resultsTree.setCurrentFunction(functionInfo);
    } catch (error) {
        console.error('Error selecting function:', error);
        vscode.window.showErrorMessage(`Failed to select function: ${(error as Error).message}`);
    }
};
