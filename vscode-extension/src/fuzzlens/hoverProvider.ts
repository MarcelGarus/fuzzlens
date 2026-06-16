import * as vscode from 'vscode';
import { FuzzLensContext } from '../types/context';
import { getCache } from '../services/cache';
import { ResultGroup } from '../types/state';
import { formatValue } from './formatting';
import { getFunctionAtPosition } from '../services/symbols';
import { getLanguageSelector } from '../config/languages';

/**
 * Provides hover information for function parameters and return types.
 * Uses cached fuzzing results to show observed types.
 *
 * The analysis (Java side) produces display-ready strings, so this provider
 * just reads aggregation strings and group keys and renders them.
 */
export class FuzzLensHoverProvider implements vscode.HoverProvider {
    constructor(private readonly ctx: FuzzLensContext) { }

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | null> {
        const filePath = document.uri.fsPath;
        const cache = getCache();

        const containingFunction = await getFunctionAtPosition(document, position);
        if (!containingFunction) {
            return null;
        }

        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return null;
        }

        const isOnFunctionName = containingFunction.selectionRange.contains(position);

        const cachedResult = cache.get(filePath, containingFunction.name);
        if (!cachedResult) {
            if (isOnFunctionName) {
                return new vscode.Hover(
                    new vscode.MarkdownString(
                        `**FuzzLens**: Function \`${containingFunction.name}\` found but not yet fuzzed.\n\n` +
                        `Run "FuzzLens: Fuzz Current File" to analyze.`
                    ),
                    wordRange
                );
            }
            return null;
        }

        if (isOnFunctionName) {
            try {
                const markdown = this.buildFunctionHoverContent(containingFunction.name, cachedResult.analyses);
                return new vscode.Hover(markdown, wordRange);
            } catch (error) {
                console.error('Error building function hover content:', error);
                return new vscode.Hover(
                    new vscode.MarkdownString(
                        `**FuzzLens**: Error retrieving data for function \`${containingFunction.name}\`: ${(error as Error).message} \n\n` +
                        `Please try fuzzing again.`
                    ),
                    wordRange
                );
            }
        }

        // Inside the function but not on the name — try to resolve a parameter.
        const word = document.getText(wordRange);
        const sigHelp = await vscode.commands.executeCommand<vscode.SignatureHelp>(
            'vscode.executeSignatureHelpProvider',
            document.uri,
            position
        );

        if (sigHelp?.signatures?.length) {
            const sig = sigHelp.signatures[sigHelp.activeSignature ?? 0];
            const paramIndex = sig.parameters?.findIndex(p => {
                const label = typeof p.label === 'string' ? p.label : p.label[0];
                return label === word;
            }) ?? -1;

            if (paramIndex >= 0 && sig.parameters) {
                const paramLabel = typeof sig.parameters[paramIndex].label === 'string'
                    ? sig.parameters[paramIndex].label
                    : sig.parameters[paramIndex].label[0];

                const md = this.buildParameterHoverContent(
                    containingFunction.name,
                    paramLabel.toString(),
                    cachedResult.analyses
                );
                return new vscode.Hover(md, wordRange);
            }
        }

        return null;
    }

    private buildParameterHoverContent(
        functionName: string,
        paramName: string,
        analyses: Map<string, ResultGroup>
    ): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        md.supportHtml = true;

        md.appendMarkdown(`### 🔧 FuzzLens Parameter: \`${paramName}\`\n\n`);
        md.appendMarkdown(`Function: \`${functionName}\`\n\n`);

        const input = analyses.get('observedSignature')?.aggregations?.['Input'] as string | undefined;
        if (input) {
            md.appendMarkdown(`**Observed Input:**\n\n`);
            md.appendCodeblock(input, 'text');
        } else {
            md.appendMarkdown(`*No fuzzing data available yet. Run the fuzzer to collect data.*\n`);
        }

        return md;
    }

    private buildFunctionHoverContent(
        functionName: string,
        analyses: Map<string, ResultGroup>
    ): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        md.supportHtml = true;

        md.appendMarkdown(`**FuzzLens**: \`${functionName}\`\n\n`);

        // --- Signature ---
        const signature = analyses.get('observedSignature');
        if (signature?.aggregations) {
            const inputStr = (signature.aggregations['Input'] as string) ?? 'any';
            const outputStr = (signature.aggregations['Output'] as string) ?? 'unknown';
            md.appendCodeblock(`${inputStr}\n→ ${outputStr}`, 'text');
            md.appendMarkdown(`\n`);
        }

        md.appendMarkdown(`---\n\n`);

        // --- Type Mapping ---
        const typeTable = analyses.get('inputShapeOutputTypeTable');
        if (typeTable?.children?.length) {
            md.appendMarkdown(`**Type Mapping**\n\n`);
            for (const group of typeTable.children) {
                const inputStr = (group.aggregations?.['Input'] as string) ?? '—';
                const count = group.aggregations?.['Count'] as number | undefined;
                const countStr = count !== undefined ? `${count}` : `${group.samples?.length ?? 0}`;

                md.appendMarkdown(`- Input:\n`);
                md.appendCodeblock(inputStr, 'text');
                md.appendMarkdown(`  Output: \`${group.key}\` (×${countStr})\n`);
            }
            md.appendMarkdown(`\n`);
        }

        // --- Exceptions ---
        const exceptions = analyses.get('exceptionExamples');
        if (exceptions?.children?.length) {
            md.appendMarkdown(`**Exceptions**\n\n`);
            const maxExceptions = 5;
            for (const group of exceptions.children.slice(0, maxExceptions)) {
                const count = group.aggregations?.['Count'] as number | undefined;
                const countStr = count ? ` ×${count}` : '';

                let exampleStr = '';
                if (group.samples && group.samples.length > 0) {
                    const example = group.samples[0];
                    exampleStr = ` - e.g. \`${formatValue(example.input, example.universe)}\``;
                }

                md.appendMarkdown(`- ⚠️ \`${group.key}\`${countStr}${exampleStr}\n`);
            }
            if (exceptions.children.length > maxExceptions) {
                md.appendMarkdown(`- *+${exceptions.children.length - maxExceptions} more exception groups...*\n`);
            }
            md.appendMarkdown(`\n`);
        }

        // --- Examples ---
        const validExamples = analyses.get('validExamples');
        if (validExamples?.samples?.length) {
            md.appendMarkdown(`**Examples**\n\n`);
            for (const result of validExamples.samples.slice(0, 5)) {
                const input = formatValue(result.input, result.universe);
                md.appendMarkdown(`- \`${input}\` → \`${result.value}\`\n`);
            }
        }

        return md;
    }
}

export function registerHoverProvider(ctx: FuzzLensContext): vscode.Disposable {
    const provider = new FuzzLensHoverProvider(ctx);
    const selector = getLanguageSelector();

    return vscode.languages.registerHoverProvider(selector, provider);
}
