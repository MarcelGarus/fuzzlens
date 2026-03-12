import * as vscode from 'vscode';
import { FuzzLensContext } from '../types/context';
import { getCache } from '../services/cache';
import { ResultGroup, GroupKey, SingleKey, CompositeKey, Shape } from '../types/state';
import { formatValue, formatPropertyShapeUnion, formatShapeNew, formatKeyValue } from './formatting';
import { getFunctionAtPosition } from '../services/symbols';
import { getLanguageSelector } from '../config/languages';

/**
 * Provides hover information for function parameters and return types.
 * Uses cached fuzzing results to show observed types.
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

        // First, check if we're inside any function (using LSP)
        const containingFunction = await getFunctionAtPosition(document, position);
        if (!containingFunction) {
            return null;
        }

        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return null;
        }

        // Check if we're hovering over the function name itself
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

        // We're inside the function but not on the function name
        // Check if we're on a parameter
        const word = document.getText(wordRange);
        
        // NOTE: SignatureHelpProvider limitation:
        // vscode.executeSignatureHelpProvider typically returns undefined when called
        // outside a function call context (i.e., not at the opening parenthesis).
        // To make this work, we would need to:
        // 1. Parse the function signature ourselves using the document symbols
        // 2. Match the word at the cursor position against parameter names
        // 3. Determine which parameter index the word represents
        // For now, parameter hover is not implemented - only function name hover works.
        // Try to get parameter info from signature help
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
                    paramIndex,
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
        paramIndex: number,
        analyses: Map<string, ResultGroup>
    ): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        md.supportHtml = true;

        md.appendMarkdown(`### 🔧 FuzzLens Parameter: \`${paramName}\`\n\n`);
        md.appendMarkdown(`Function: \`${functionName}\`\n\n`);

        // Show observed input shapes for this parameter
        const typeTable = analyses.get('inputShapeOutputTypeTable');
        if (typeTable && typeTable.children && typeTable.children?.length > 0) {
            const inputShapes = new Set<string>();
            
            for (const group of typeTable.children) {
                // Extract input shape from the group key
                if (group.key.type === 'Composite') {
                    const compositeKey = group.key as CompositeKey;
                    for (const part of compositeKey.parts) {
                        if (part.column === 'InputShape' || part.column === 'inputShape') {
                            // value is a Shape object
                            if (typeof part.value === 'object' && part.value && 'type' in part.value) {
                                inputShapes.add(formatShapeNew(part.value as Shape));
                            }
                        }
                    }
                } else if (group.key.type === 'Single') {
                    const singleKey = group.key as SingleKey;
                    if (singleKey.column === 'InputShape' || singleKey.column === 'inputShape') {
                        if (typeof singleKey.value === 'object' && singleKey.value && 'type' in singleKey.value) {
                            inputShapes.add(formatShapeNew(singleKey.value as Shape));
                        }
                    }
                }
            }

            if (inputShapes.size > 0) {
                md.appendMarkdown(`**Observed Input Shapes:**\n\n`);
                const shapesArray = Array.from(inputShapes);
                for (const shape of shapesArray.slice(0, 10)) {
                    md.appendMarkdown(`- \`${shape}\`\n`);
                }
                if (shapesArray.length > 10) {
                    md.appendMarkdown(`\n*+${shapesArray.length - 10} more shapes...*\n`);
                }
            } else {
                md.appendMarkdown(`*No input shape data available yet. Run fuzzer to collect data.*\n`);
            }
        } else {
            md.appendMarkdown(`*No fuzzing data available. Run fuzzer to collect parameter information.*\n`);
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
        if (signature) {
            const inputShapes = signature.aggregations?.['InputShapes'] as Record<string, unknown> | undefined;
            const outputTypes = signature.aggregations?.['OutputTypes'] as Set<string> | string[] | undefined;

            let inputStr = 'any';
            if (inputShapes && Object.keys(inputShapes).length > 0) {
                inputStr = this.formatInputShapesMultiline(inputShapes);
            }

            let outputStr = 'unknown';
            if (outputTypes) {
                const outputArr = Array.isArray(outputTypes) ? outputTypes : [...outputTypes];
                if (outputArr.length > 0) {
                    outputStr = this.sortUnionTypes(outputArr).join(' | ');
                }
            }

            md.appendCodeblock(`${inputStr}\n→ ${outputStr}`, 'text');
            md.appendMarkdown(`\n`);
        }

        // --- Separator ---
        md.appendMarkdown(`---\n\n`);

        // --- Type Mapping ---
        const typeTable = analyses.get('inputShapeOutputTypeTable');
        if (typeTable && typeTable.children && typeTable.children.length > 0) {
            md.appendMarkdown(`**Type Mapping**\n\n`);

            for (const group of typeTable.children) {
                const keyParts = this.extractKeyParts(group.key);
                const count = group.aggregations?.['Count'] as number | undefined;
                const inputShapes = group.aggregations?.['InputShapes'];

                const inputStrFromAgg = inputShapes && typeof inputShapes === 'object'
                    ? formatPropertyShapeUnion(inputShapes as Record<string, unknown>)
                    : undefined;
                const inputStr = inputStrFromAgg || keyParts.InputShape || keyParts.inputShape || '—';
                const outputStr = this.sortUnionTypes(
                    this.splitUnionValue(
                        keyParts.OutputTypes || keyParts.outputTypes || keyParts.OutputType || keyParts.outputType || 'unknown'
                    )
                ).join(' | ');
                const countStr = count !== undefined ? `${count}` : `${group.samples?.length ?? 0}`;

                md.appendMarkdown(`- \`${inputStr}\` → \`${outputStr}\` (×${countStr})\n`);
            }
            md.appendMarkdown(`\n`);
        }

        // --- Exceptions ---
        const exceptions = analyses.get('exceptionExamples');
        if (exceptions && exceptions.children && exceptions.children.length > 0) {
            md.appendMarkdown(`**Exceptions**\n\n`);
            const maxExceptions = 5;
            for (const group of exceptions.children.slice(0, maxExceptions)) {
                const keyParts = this.extractKeyParts(group.key);
                const exceptionType = keyParts.ExceptionType || keyParts.exceptionType || 'Exception';
                const inputShape = keyParts.InputShape || keyParts.inputShape;
                const count = group.aggregations?.['Count'] as number | undefined;
                const countStr = count ? ` ×${count}` : '';

                let exampleStr = '';
                if (group.samples && group.samples.length > 0) {
                    const example = group.samples[0];
                    const inputStr = formatValue(example.input, example.universe);
                    exampleStr = ` - e.g. \`${inputStr}\``;
                }

                const shapePart = inputShape ? ` (InputShape=${inputShape})` : '';
                md.appendMarkdown(`- ⚠️ \`${exceptionType}\`${shapePart}${countStr}${exampleStr}\n`);
            }
            if (exceptions.children.length > maxExceptions) {
                md.appendMarkdown(`- *+${exceptions.children.length - maxExceptions} more exception groups...*\n`);
            }
            md.appendMarkdown(`\n`);
        }

        // --- Examples ---
        const validExamples = analyses.get('validExamples');
        if (validExamples && validExamples.samples && validExamples.samples.length > 0) {
            md.appendMarkdown(`**Examples**\n\n`);
            for (const result of validExamples.samples.slice(0, 5)) {
                const input = formatValue(result.input, result.universe);
                md.appendMarkdown(`- \`${input}\` → \`${result.value}\`\n`);
            }
        }

        return md;
    }

    private extractKeyParts(key: GroupKey): Record<string, string> {
        const parts: Record<string, string> = {};

        if (!key || typeof key !== 'object') {
            return parts;
        }

        if (key.type === 'Single') {
            const single = key as SingleKey;
            parts[single.column] = formatKeyValue(single.value);
            return parts;
        }

        if (key.type === 'Composite') {
            const composite = key as CompositeKey;
            for (const part of composite.parts ?? []) {
                parts[part.column] = formatKeyValue(part.value);
            }
        }

        return parts;
    }

    private splitUnionValue(value: string): string[] {
        return value
            .split('|')
            .map(x => x.trim())
            .filter(x => x.length > 0);
    }

    private sortUnionTypes(types: string[]): string[] {
        const rank = (t: string): number => {
            const normalized = t.toLowerCase();
            if (normalized === 'null') { return 0; }
            if (normalized === 'boolean' || normalized === 'bool') { return 1; }
            if (normalized === 'int') { return 2; }
            if (normalized === 'double' || normalized === 'float') { return 3; }
            if (normalized === 'string' || normalized === 'str') { return 4; }
            if (normalized === 'crash') { return 999; }
            return 100;
        };

        return Array.from(new Set(types)).sort((a, b) => {
            const rankDiff = rank(a) - rank(b);
            if (rankDiff !== 0) {
                return rankDiff;
            }
            return a.localeCompare(b);
        });
    }

    private formatInputShapesMultiline(inputShapes: Record<string, unknown>): string {
        const entries = Object.entries(inputShapes).filter(([key]) => key !== '__type__');
        if (entries.length === 0) {
            return 'any';
        }

        const lines: string[] = ['{'];
        const sortedEntries = entries.sort(([a], [b]) => a.localeCompare(b));
        for (const [index, [key, shapes]] of sortedEntries.entries()) {
            const union = Array.isArray(shapes)
                ? this.sortUnionTypes((shapes as Shape[]).map(shape => formatShapeNew(shape, 1))).join(' | ')
                : 'unknown';
            const suffix = index < sortedEntries.length - 1 ? ',' : '';
            lines.push(`  ${key}: ${union}${suffix}`);
        }
        lines.push('}');

        return lines.join('\n');
    }

}

export function registerHoverProvider(ctx: FuzzLensContext): vscode.Disposable {
    const provider = new FuzzLensHoverProvider(ctx);
    const selector = getLanguageSelector();

    return vscode.languages.registerHoverProvider(selector, provider);
}
