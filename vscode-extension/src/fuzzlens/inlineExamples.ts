import { RunResult, ProcessState, ResultGroup, Universe, Value, InlineExamplesState, RunResultInGroup } from "../types/state";
import * as vscode from "vscode";
import { applyDecoration, clearDecorations } from "../services/inlineDecorations";
import { FuzzLensContext } from "../types/context";
import { getFunctionLineByPath, resolveLineNumber, FunctionNotFoundError } from "../services/symbols";
import { getAutoRotate, getRotationInterval, getShowInlineExamples, getMaxInlineExamples, getMaxInlineExampleLength } from "../config/defaults";

export const startExampleRotation = (ctx: FuzzLensContext): void => {
    const state = ctx.state.inlineExamples;

    if (state.rotationInterval) {
        clearInterval(state.rotationInterval);
    }

    const intervalMs = getRotationInterval();

    state.rotationInterval = setInterval(() => {
        if (state.isPaused) { return; }

        const showInline = getShowInlineExamples();
        if (!showInline) { return; }

        rotateAllExamples(ctx);
    }, intervalMs);
};

export const stopExampleRotation = (ctx: FuzzLensContext): void => {
    const state = ctx.state.inlineExamples;
    if (state.rotationInterval) {
        clearInterval(state.rotationInterval);
        state.rotationInterval = undefined;
    }
};

export const pauseRotation = (ctx: FuzzLensContext): void => {
    const state = ctx.state.inlineExamples;
    state.isPaused = true;
};

export const resumeRotation = (ctx: FuzzLensContext): void => {
    const state = ctx.state.inlineExamples;
    state.isPaused = false;
};

export const showNextExample = (ctx: FuzzLensContext): void => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    const state = ctx.state.inlineExamples;
    const filePath = editor.document.uri.fsPath;

    for (const [key, exState] of state.examples.entries()) {
        if (exState.filePath === filePath && exState.examples.length > 1) {
            exState.currentIndex = (exState.currentIndex + 1) % exState.examples.length;
            const resolvedLine = resolveLineNumber(exState.line, editor.document);
            showExampleAtLine(editor, resolvedLine, exState.examples[exState.currentIndex]);
        }
    }
};

export const showPreviousExample = (ctx: FuzzLensContext): void => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    const state = ctx.state.inlineExamples;
    const filePath = editor.document.uri.fsPath;

    for (const [key, exState] of state.examples.entries()) {
        if (exState.filePath === filePath && exState.examples.length > 1) {
            exState.currentIndex = (exState.currentIndex - 1 + exState.examples.length) % exState.examples.length;
            const resolvedLine = resolveLineNumber(exState.line, editor.document);
            showExampleAtLine(editor, resolvedLine, exState.examples[exState.currentIndex]);
        }
    }
};

export const setupFuzzerResultsListener = (ctx: FuzzLensContext): vscode.Disposable => {
    const resultsListener = ctx.events.onFuzzerResultsReady.event((processState) => {
        handleFuzzerResults(ctx, processState);
    });

    if (getAutoRotate()) {
        startExampleRotation(ctx);
    }

    ctx.events.onInlineExamplesToggled.event((enabled) => {
        if (enabled) {
            refreshInlineDecorations(ctx);
        } else {
            clearAllInlineDecorations(ctx);
        }
    });

    return resultsListener;
};

export const handleFuzzerResults = async (ctx: FuzzLensContext, processState: ProcessState) => {
    const runs = await processState.results;
    if (!runs || runs.length === 0) {
        ctx.output.appendLine('No fuzzing results received.');
        return;
    }

    logFuzzerResults(ctx.output, runs);

    const showInline = getShowInlineExamples();

    if (showInline && processState.analyses) {
        const relevantPairs = processState.analyses.get('relevantPairs');
        const filePath = processState.file;
        const functionName = processState.functionName;

        let line: number;
        try {
            line = await getFunctionLineByPath(filePath, functionName);
        } catch (error) {
            if (error instanceof FunctionNotFoundError) {
                console.error(`Function not found for inline examples: ${functionName} in ${filePath}`);
                vscode.window.showErrorMessage(`Cannot show inline examples: function "${functionName}" not found in file ${filePath}.`);
                return;
            } else {
                throw error;
            }
        }

        if (relevantPairs) {
            addInlineExamplesFromAnalysis(ctx, relevantPairs, filePath, line, functionName);
        } else {
            addInlineExamplesFromRuns(ctx, runs, filePath, line, functionName);
        }
    }
};

const addInlineExamplesFromAnalysis = (
    ctx: FuzzLensContext,
    group: ResultGroup,
    filePath: string,
    line: number,
    functionName: string
) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    const maxExamples = getMaxInlineExamples();

    // Collect top examples - check both root results and children recursively
    const examples: string[] = [];
    
    const collectExamples = (g: ResultGroup, depth: number = 0) => {
        if (examples.length >= maxExamples) { return; }
        
        // First try direct results
        if (g.samples && g.samples.length > 0) {
            for (const result of g.samples.slice(0, maxExamples - examples.length)) {
                const exampleStr = resultToDecorationString(result);
                if (exampleStr) {
                    examples.push(exampleStr);
                }
                if (examples.length >= maxExamples) { return; }
            }
        }
        
        // Then recurse into children (limited depth)
        if (g.children && depth < 3) {
            for (const child of g.children) {
                collectExamples(child, depth + 1);
                if (examples.length >= maxExamples) { return; }
            }
        }
    };
    
    collectExamples(group);

    if (examples.length === 0) { return; }

    const state = ctx.state.inlineExamples;
    const key = `${filePath}:${functionName}`;

    state.examples.set(key, {
        filePath,
        functionName,
        line,
        examples: examples.slice(0, maxExamples),
        currentIndex: 0
    });

    const resolvedLine = resolveLineNumber(line, editor.document);
    showExampleAtLine(editor, resolvedLine, examples[0]);
};

const addInlineExamplesFromRuns = (ctx: FuzzLensContext, results: RunResult[], filePath: string, line: number, functionName: string) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor to add fuzzer result decorations to.');
        return;
    }

    const maxExamples = getMaxInlineExamples();

    // Pick diverse examples (first, last, and some in between)
    const examples: string[] = [];
    const indices = selectDiverseIndices(results.length, maxExamples);

    for (const idx of indices) {
        const result = results[idx];
        const exampleStr = resultToDecorationString(result);
        if (exampleStr) {
            examples.push(exampleStr);
        }
    }

    if (examples.length === 0) { return; }

    const state = ctx.state.inlineExamples;
    const key = `${filePath}:${functionName}`;

    state.examples.set(key, {
        filePath,
        functionName,
        line,
        examples,
        currentIndex: 0
    });

    const resolvedLine = resolveLineNumber(line, editor.document);
    showExampleAtLine(editor, resolvedLine, examples[0]);
};

// === Example Rotation ===

const rotateAllExamples = (ctx: FuzzLensContext) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    const inlineState = ctx.state.inlineExamples;
    const filePath = editor.document.uri.fsPath;

    for (const [key, exState] of inlineState.examples.entries()) {
        if (exState.filePath === filePath && exState.examples.length > 1) {
            exState.currentIndex = (exState.currentIndex + 1) % exState.examples.length;
            const resolvedLine = resolveLineNumber(exState.line, editor.document);
            showExampleAtLine(editor, resolvedLine, exState.examples[exState.currentIndex]);
        }
    }
};

const refreshInlineDecorations = (ctx: FuzzLensContext) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    const inlineState = ctx.state.inlineExamples;
    const filePath = editor.document.uri.fsPath;

    for (const [key, exState] of inlineState.examples.entries()) {
        if (exState.filePath === filePath) {
            const resolvedLine = resolveLineNumber(exState.line, editor.document);
            showExampleAtLine(editor, resolvedLine, exState.examples[exState.currentIndex]);
        }
    }
};

const clearAllInlineDecorations = (ctx: FuzzLensContext) => {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        clearDecorations(editor);
    }
    // Also clear the state
    const inlineState = ctx.state.inlineExamples;
    inlineState.examples.clear();
};

// === Decoration Helpers ===

const showExampleAtLine = (editor: vscode.TextEditor, line: number, text: string) => {
    applyDecoration(editor, line, text);
};

const selectDiverseIndices = (total: number, count: number): number[] => {
    if (total <= count) {
        return Array.from({ length: total }, (_, i) => i);
    }

    const indices: number[] = [];
    const step = (total - 1) / (count - 1);
    for (let i = 0; i < count; i++) {
        indices.push(Math.round(i * step));
    }
    return indices;
};

const resultToDecorationString = (result: RunResult | RunResultInGroup, maxLength: number = 500): string => {
    const inputValue = valueToString(result.input, result.universe);

    let decorationStr: string;

    if (result.didCrash) {
        decorationStr = `${inputValue} → Crash: ${result.message || 'Unknown'}`;
    } else {
        decorationStr = `${inputValue} → ${valueAndTypeNameToString(result.value!, result.typeName!)}`;
    }

    // Don't truncate here - let applyDecoration handle truncation based on line length
    return decorationStr;
};

const logFuzzerResults = (output: vscode.OutputChannel, results: RunResult[]) => {
    output.appendLine(`Received ${results.length} fuzzing results.`);
    for (const result of results.slice(0, 10)) { // Log first 10
        const inputValue = valueToString(result.input, result.universe);
        if (result.didCrash) {
            output.appendLine(`  ${inputValue} → Crash: ${result.message}`);
        } else {
            output.appendLine(`  ${inputValue} → ${result.value} (${result.typeName})`);
        }
    }
    if (results.length > 10) {
        output.appendLine(`  ... and ${results.length - 10} more`);
    }
};

const valueAndTypeNameToString = (value: string, typeName: string): string => {
    switch (typeName) {
        case 'String':
        case 'string':
            return `"${value}"`;
        default:
            return `${value}`;
    }
};

const valueToString = (input: Value | Partial<Value>, universe: Universe): string => {
    if (!input || Object.keys(input).length === 0) {
        return '{}';
    }

    if (!('type' in input) || !input.type) {
        // Object without type field - check for id
        if ('id' in input && input.id) {
            const objId = (input.id as { value: number }).value;
            const objDef = universe.objects['$' + objId];
            if (objDef) {
                const members = Object.entries(objDef.members);
                if (members.length === 0) { return '{}'; }
                const memberStrings = members.map(([key, val]) => `${key}: ${valueToString(val, universe)}`);
                return `{${memberStrings.join(', ')}}`;
            }
        }
        return '{}';
    }

    switch (input.type) {
        case 'Null':
            return 'null';
        case 'Boolean':
            return (input as { type: 'Boolean'; value: boolean }).value.toString();
        case 'Int':
            return (input as { type: 'Int'; value: number }).value.toString();
        case 'Double':
            const doubleVal = (input as { type: 'Double'; value: number }).value;
            let fixed = doubleVal.toFixed(2);
            while (fixed.endsWith('0') && fixed.includes('.')) {
                fixed = fixed.slice(0, -1);
            }
            if (fixed.endsWith('.')) { fixed = fixed.slice(0, -1); }
            return fixed;
        case 'String':
            const strVal = (input as { type: 'String'; value: string }).value;
            return `"${strVal}"`;
        case 'Object':
            const objId = (input as { type: 'Object'; id: { value: number } }).id.value;
            const objDef = universe.objects['$' + objId];
            if (objDef) {
                const members = Object.entries(objDef.members);
                if (members.length === 0) { return '{}'; }
                const memberStrings = members.map(([key, val]) => `${key}: ${valueToString(val, universe)}`);
                return `{${memberStrings.join(', ')}}`;
            }
            return 'Object';
        default:
            return 'unknown';
    }
};
