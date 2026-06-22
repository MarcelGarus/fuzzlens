import * as vscode from 'vscode';

import { ProcessState, RunResult } from '../types/state';
import { findFunctionByName } from '../services/symbols';
import { applyDecoration } from '../services/inlineDecorations';
import { formatValue, formatRunResult } from './formatting';
import { getShowInlineExamples } from '../config/defaults';

/**
 * Matches a line that is a `return` statement (Python / JavaScript). The `\b`
 * after `return` keeps `returned`, `return_value`, etc. from matching. Lines
 * that merely *look* like returns but aren't actually executed are filtered out
 * anyway, since we only decorate return lines that some run's coverage reached.
 */
const RETURN_RE = /^\s*return\b/;

/**
 * Show an example next to every return statement in the fuzzed function: for
 * each return, an input that actually reaches it (taken from the run coverage),
 * rendered as `input → output`.
 *
 * Runs on every results/progress update, so the examples appear as runs stream
 * in and refresh when the code is re-fuzzed after an edit.
 */
export async function updateReturnExamples(processState: ProcessState): Promise<void> {
    if (!getShowInlineExamples()) {
        return;
    }

    const runs = await processState.results;
    if (!runs || runs.length === 0) {
        return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.fsPath !== processState.file) {
        return;
    }

    const fn = await findFunctionByName(editor.document, processState.functionName);
    if (!fn) {
        return;
    }

    const document = editor.document;
    const startLine = fn.range.start.line;
    const endLine = Math.min(fn.range.end.line, document.lineCount - 1);

    // Map each return statement's backend line (1-based) to its editor line (0-based).
    const returnLines = new Map<number, number>();
    for (let line = startLine; line <= endLine; line++) {
        if (RETURN_RE.test(document.lineAt(line).text)) {
            returnLines.set(line + 1, line);
        }
    }
    if (returnLines.size === 0) {
        return;
    }

    // Pick a representative input for each return: a non-crashing run whose
    // coverage includes that return's line, preferring the simplest input.
    const chosen = new Map<number, RunResult>();
    for (const run of runs) {
        if (run.didCrash || !run.coveredLines) {
            continue;
        }
        for (const backendLine of run.coveredLines) {
            if (!returnLines.has(backendLine)) {
                continue;
            }
            const existing = chosen.get(backendLine);
            if (!existing || inputLength(run) < inputLength(existing)) {
                chosen.set(backendLine, run);
            }
        }
    }

    for (const [backendLine, editorLine] of returnLines) {
        const run = chosen.get(backendLine);
        if (run) {
            applyDecoration(editor, editorLine, formatRunResult(run)); // 'confirmed' (green)
        }
    }
}

function inputLength(run: RunResult): number {
    return formatValue(run.input, run.universe).length;
}
