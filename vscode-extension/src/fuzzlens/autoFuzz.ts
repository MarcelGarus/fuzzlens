import * as vscode from 'vscode';

import { FuzzLensContext } from '../types/context';
import { ProcessState } from '../types/state';
import { getFunctionSymbols } from '../services/symbols';
import { getCache } from '../services/cache';
import {
    spawnFuzzLensProcess,
    removeFromStateOnceExited,
    writeProcessOutputToState,
} from '../services/fuzzer';
import { clearInlineExamplesForFile } from './inlineExamples';
import { isSupportedFile, getGraalLanguageForFile } from '../config/languages';
import { getAutoFuzzOnView } from '../config/defaults';

/** How long to wait after the viewport settles before scanning for functions. */
const DEBOUNCE_MS = 400;

/** How long to wait after the last keystroke before re-fuzzing an edited file. */
const REFUZZ_DEBOUNCE_MS = 600;

/**
 * Cap on how many fuzzer processes auto-fuzz keeps in flight at once, so that
 * scrolling through a large file doesn't spawn a flood of processes. Manual runs
 * count towards this limit too (they share `runningProcesses`).
 */
const MAX_CONCURRENT = 3;

/**
 * Automatically fuzz functions as they come into view and re-fuzz them as the
 * code is edited.
 *
 * - On viewport / active-editor changes, any visible function that hasn't been
 *   run yet is fuzzed.
 * - On edits, the affected file's cached results are dropped and its visible
 *   functions are re-fuzzed against the live (possibly unsaved) buffer, so the
 *   results always reflect what's on screen.
 */
export function registerAutoFuzzOnView(ctx: FuzzLensContext): vscode.Disposable {
    // Keys ("filePath:functionName") we've already kicked off for the current
    // version of the code, to avoid re-spawning on every scroll event. Cleared
    // for a file when it's edited so the new code gets fuzzed.
    const attempted = new Set<string>();
    let scanTimer: NodeJS.Timeout | undefined;
    const refuzzTimers = new Map<string, NodeJS.Timeout>();

    const scheduleScan = (editor: vscode.TextEditor | undefined) => {
        if (!getAutoFuzzOnView()) {
            return;
        }
        if (scanTimer) {
            clearTimeout(scanTimer);
        }
        scanTimer = setTimeout(() => {
            void scanVisibleFunctions(ctx, editor, attempted);
        }, DEBOUNCE_MS);
    };

    const visibleRangesListener = vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
        if (e.textEditor === vscode.window.activeTextEditor) {
            scheduleScan(e.textEditor);
        }
    });

    const activeEditorListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
        scheduleScan(editor);
    });

    const changeListener = vscode.workspace.onDidChangeTextDocument((e) => {
        if (!getAutoFuzzOnView() || e.contentChanges.length === 0) {
            return;
        }
        const document = e.document;
        if (document.uri.scheme !== 'file' || !isSupportedFile(document.uri.fsPath)) {
            return;
        }
        // Only react to edits in the document the user is actively viewing.
        if (vscode.window.activeTextEditor?.document !== document) {
            return;
        }

        const file = document.uri.fsPath;
        const existing = refuzzTimers.get(file);
        if (existing) {
            clearTimeout(existing);
        }
        refuzzTimers.set(file, setTimeout(() => {
            refuzzTimers.delete(file);
            void reFuzzChangedFile(ctx, file, attempted);
        }, REFUZZ_DEBOUNCE_MS));
    });

    // Saving doesn't change buffer content (so onDidChangeTextDocument won't
    // fire), but the disk file-watcher in FunctionsTreeProvider invalidates the
    // cache on save. Re-fuzz so saved files keep their results instead of
    // reverting to "not run".
    const saveListener = vscode.workspace.onDidSaveTextDocument((document) => {
        if (!getAutoFuzzOnView()) {
            return;
        }
        if (document.uri.scheme !== 'file' || !isSupportedFile(document.uri.fsPath)) {
            return;
        }
        if (vscode.window.activeTextEditor?.document !== document) {
            return;
        }

        const file = document.uri.fsPath;
        const existing = refuzzTimers.get(file);
        if (existing) {
            clearTimeout(existing);
        }
        // Run after the fs watcher has invalidated the cache so we end on fresh results.
        refuzzTimers.set(file, setTimeout(() => {
            refuzzTimers.delete(file);
            void reFuzzChangedFile(ctx, file, attempted);
        }, REFUZZ_DEBOUNCE_MS));
    });

    // Scan whatever is already open when the extension activates.
    scheduleScan(vscode.window.activeTextEditor);

    return vscode.Disposable.from(visibleRangesListener, activeEditorListener, changeListener, saveListener, {
        dispose: () => {
            if (scanTimer) {
                clearTimeout(scanTimer);
            }
            for (const timer of refuzzTimers.values()) {
                clearTimeout(timer);
            }
            refuzzTimers.clear();
        },
    });
}

/**
 * Drop a file's stale results and re-fuzz whatever is currently visible against
 * the edited code.
 */
async function reFuzzChangedFile(
    ctx: FuzzLensContext,
    file: string,
    attempted: Set<string>
): Promise<void> {
    // Results for the previous version of the code are no longer valid.
    getCache().invalidateFile(file);
    for (const key of [...attempted]) {
        if (key.startsWith(file + ':')) {
            attempted.delete(key);
        }
    }

    // Cancel any in-flight runs for this file — they're fuzzing the old code.
    for (const [key, processState] of [...ctx.state.runningProcesses]) {
        if (key.startsWith(file + ':')) {
            processState.cancelled = true;
            processState.process?.kill?.();
            ctx.state.runningProcesses.delete(key);
        }
    }

    // Remove now-stale inline examples until the fresh run repopulates them.
    clearInlineExamplesForFile(ctx, file);
    ctx.providers.functionsTree.refresh();

    await scanVisibleFunctions(ctx, vscode.window.activeTextEditor, attempted);
}

async function scanVisibleFunctions(
    ctx: FuzzLensContext,
    editor: vscode.TextEditor | undefined,
    attempted: Set<string>
): Promise<void> {
    editor = editor ?? vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }

    const document = editor.document;
    if (document.uri.scheme !== 'file' || !isSupportedFile(document.uri.fsPath)) {
        return;
    }

    const visibleRanges = editor.visibleRanges;
    if (visibleRanges.length === 0) {
        return;
    }

    const symbols = await getFunctionSymbols(document);
    if (symbols.length === 0) {
        return;
    }

    // The viewport may have changed (or the editor switched away) while we were
    // awaiting symbols; bail if this is no longer the active editor.
    if (vscode.window.activeTextEditor !== editor) {
        return;
    }

    const file = document.uri.fsPath;
    const cache = getCache();

    for (const fn of symbols) {
        if (ctx.state.runningProcesses.size >= MAX_CONCURRENT) {
            break;
        }

        const isVisible = visibleRanges.some((range) => range.intersection(fn.range) !== undefined);
        if (!isVisible) {
            continue;
        }

        const key = `${file}:${fn.name}`;
        if (attempted.has(key) || ctx.state.runningProcesses.has(key) || cache.has(file, fn.name)) {
            continue;
        }

        attempted.add(key);
        triggerFuzz(ctx, document, fn.name);
    }
}

/**
 * Start a fuzzer run for a single function without any user-facing progress
 * notification (this fires for whatever scrolls into view or gets edited, so it
 * must stay quiet). Fuzzes the live buffer content so unsaved edits are reflected.
 */
function triggerFuzz(ctx: FuzzLensContext, document: vscode.TextDocument, functionName: string): void {
    const file = document.uri.fsPath;
    const key = `${file}:${functionName}`;
    try {
        ctx.providers.functionsTree.updateFunctionStatus(file, functionName, 'running');

        const process = spawnFuzzLensProcess({
            extensionPath: ctx.vscode.extensionPath,
            file,
            functionName,
            code: document.getText(),
            language: getGraalLanguageForFile(file),
        });

        const processState: ProcessState = {
            process,
            file,
            functionName,
            startedAt: Date.now(),
        };
        ctx.state.runningProcesses.set(key, processState);

        process.on('exit', (code) => {
            if (code !== 0 && !processState.cancelled) {
                ctx.providers.functionsTree.updateFunctionStatus(file, functionName, 'not-run');
            }
        });

        removeFromStateOnceExited(processState, ctx.state);
        // Quiet errors: half-typed code will fail to parse, which is expected.
        writeProcessOutputToState(ctx, processState, { showErrors: false });
    } catch (error) {
        ctx.output.appendLine(`Auto-fuzz error for ${functionName}: ${(error as Error).message}`);
    }
}
