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
import { isSupportedFile } from '../config/languages';
import { getAutoFuzzOnView } from '../config/defaults';

/** How long to wait after the viewport settles before scanning for functions. */
const DEBOUNCE_MS = 400;

/**
 * Cap on how many fuzzer processes auto-fuzz keeps in flight at once, so that
 * scrolling through a large file doesn't spawn a flood of processes. Manual runs
 * count towards this limit too (they share `runningProcesses`).
 */
const MAX_CONCURRENT = 3;

/**
 * Automatically fuzz functions as they scroll into view.
 *
 * Listens for viewport and active-editor changes, and for any function whose
 * range is currently visible, kicks off a fuzzer run. Functions that are already
 * running, already have cached results, or were already attempted this session
 * are skipped, so each function is only fuzzed once as it appears.
 */
export function registerAutoFuzzOnView(ctx: FuzzLensContext): vscode.Disposable {
    // Keys ("filePath:functionName") we've already kicked off this session, to
    // avoid re-spawning on every scroll event (cache only covers successes).
    const attempted = new Set<string>();
    let timer: NodeJS.Timeout | undefined;

    const scheduleScan = (editor: vscode.TextEditor | undefined) => {
        if (!getAutoFuzzOnView()) {
            return;
        }
        if (timer) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
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

    // Scan whatever is already open when the extension activates.
    scheduleScan(vscode.window.activeTextEditor);

    return vscode.Disposable.from(visibleRangesListener, activeEditorListener, {
        dispose: () => {
            if (timer) {
                clearTimeout(timer);
            }
        },
    });
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
        triggerFuzz(ctx, file, fn.name);
    }
}

/**
 * Start a fuzzer run for a single function without any user-facing progress
 * notification (this fires for whatever scrolls into view, so it must stay quiet).
 * Mirrors the wiring in the `runFuzzerOnFunction` command.
 */
function triggerFuzz(ctx: FuzzLensContext, file: string, functionName: string): void {
    const key = `${file}:${functionName}`;
    try {
        ctx.providers.functionsTree.updateFunctionStatus(file, functionName, 'running');

        const process = spawnFuzzLensProcess({
            extensionPath: ctx.vscode.extensionPath,
            file,
            functionName,
        });

        const processState: ProcessState = {
            process,
            file,
            functionName,
            startedAt: Date.now(),
        };
        ctx.state.runningProcesses.set(key, processState);

        process.on('exit', (code) => {
            if (code !== 0) {
                ctx.providers.functionsTree.updateFunctionStatus(file, functionName, 'not-run');
            }
        });

        removeFromStateOnceExited(processState, ctx.state);
        writeProcessOutputToState(ctx, processState); // -> onFuzzerResultsReady event
    } catch (error) {
        ctx.output.appendLine(`Auto-fuzz error for ${functionName}: ${(error as Error).message}`);
    }
}
