import * as vscode from 'vscode';

import { ProcessState } from '../types/state';
import { applyDecoration } from '../services/inlineDecorations';
import { formatRunResult } from './formatting';
import { getShowInlineExamples } from '../config/defaults';

/**
 * Show an example next to every return statement in the fuzzed function,
 * rendered as `input → output`.
 *
 * The selection — which input best represents each return — is curated by the
 * daemon (the `returnExamples` snapshot: one leaf per return line, carrying the
 * 1-based source line and the chosen run as its sample). Here we only render it.
 * Runs on every snapshot, so examples appear live and refresh after an edit.
 */
export async function updateReturnExamples(processState: ProcessState): Promise<void> {
    if (!getShowInlineExamples()) {
        return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.fsPath !== processState.file) {
        return;
    }

    const group = processState.analyses?.get('returnExamples');
    if (!group?.children) {
        return;
    }

    const lineCount = editor.document.lineCount;
    for (const child of group.children) {
        const backendLine = child.aggregations?.Line;
        const sample = child.samples?.[0];
        if (typeof backendLine !== 'number' || !sample) {
            continue;
        }
        const editorLine = backendLine - 1; // backend lines are 1-based
        if (editorLine < 0 || editorLine >= lineCount) {
            continue;
        }
        applyDecoration(editor, editorLine, formatRunResult(sample)); // 'confirmed' (green)
    }
}
