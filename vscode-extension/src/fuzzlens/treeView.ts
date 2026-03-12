import * as vscode from 'vscode';
import * as path from 'path';
import { FunctionInfo, ResultGroup, RunResult, Value, Universe, GroupKey, SingleKey, CompositeKey, KeyPart, ProcessState, ShapeValue, RunResultInGroup } from '../types/state';
import { getCache } from '../services/cache';
import { FuzzLensContext } from '../types/context';
import { formatShape, formatValue, formatShapeNew, formatGroupKey } from './formatting';
import { isSupportedFile, SUPPORTED_FILES_GLOB } from '../config/languages';
import { shouldIgnoreFolder } from '../config/defaults';
import { discoverFunctionsInFile } from '../services/symbols';

export type FuzzLensTreeItem =
    | WorkspaceFolderItem
    | FolderItem
    | FileItem
    | FunctionItem
    | ResultGroupItem
    | SampleItem
    | MessageItem;

export class WorkspaceFolderItem extends vscode.TreeItem {
    constructor(
        public readonly folder: vscode.WorkspaceFolder
    ) {
        super(folder.name, vscode.TreeItemCollapsibleState.Expanded);
        this.iconPath = new vscode.ThemeIcon('root-folder');
        this.contextValue = 'workspace-folder';
        this.resourceUri = folder.uri;
    }
}

export class FolderItem extends vscode.TreeItem {
    constructor(
        public readonly folderUri: vscode.Uri,
        public readonly folderName: string
    ) {
        super(folderName, vscode.TreeItemCollapsibleState.Collapsed);
        this.iconPath = new vscode.ThemeIcon('folder');
        this.contextValue = 'folder';
        // this.resourceUri = folderUri;
        // Don't set resourceUri to avoid showing file diagnostics/colors in tree
    }
}

export class FileItem extends vscode.TreeItem {
    constructor(
        public readonly fileUri: vscode.Uri,
        public readonly fileName: string,
        public readonly functions: FunctionInfo[] = []
    ) {
        super(fileName, vscode.TreeItemCollapsibleState.Collapsed);
        this.iconPath = new vscode.ThemeIcon('file-code');
        this.contextValue = 'file';
        // this.resourceUri = fileUri;
        // Don't set resourceUri to avoid showing file diagnostics/colors in tree

        // Show function count in description if available
        if (functions.length > 0) {
            this.description = `${functions.length} function${functions.length !== 1 ? 's' : ''}`;
        }

        // Make file clickable to open it
        this.command = {
            command: 'vscode.open',
            title: 'Open File',
            arguments: [fileUri]
        };
    }
}

export class FunctionItem extends vscode.TreeItem {
    constructor(
        public readonly info: FunctionInfo
    ) {
        super(info.name, vscode.TreeItemCollapsibleState.None);
        this.description = FunctionItem.getDescription(info);
        this.iconPath = new vscode.ThemeIcon('symbol-function');
        this.contextValue = `function-${info.status}`;

        // Make function clickable to show results
        this.command = {
            command: 'fuzzlens.selectFunction',
            title: 'Select Function',
            arguments: [info]
        };
    }

    private static getDescription(info: FunctionInfo): string {
        switch (info.status) {
            case 'has-results':
                return `[${info.runCount} runs]`;
            case 'outdated':
                return '[outdated]';
            case 'running':
                return '[running...]';
            case 'not-run':
            default:
                return '[not run]';
        }
    }
}

/**
 * A result group item in the results tree.
 * Displayed as:
 *   > [icon] key            (count, crashCount)
 * e.g.,
 *   > [ ] InputShape=Int    (100, 0)
 *   > [x] InputShape=String (100, 100)
 */
export class ResultGroupItem extends vscode.TreeItem {
    constructor(
        public readonly group: ResultGroup,
        public readonly depth: number = 0
    ) {
        super(
            formatGroupKey(group.key),
            (group.samples && group.samples.length > 0) || (group.children && group.children.length > 0)
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None
        );

        const count = group.aggregations?.['Count'] as number | undefined;
        const crashCount = group.aggregations?.['CrashCount'] as number | undefined;

        if (count !== undefined) {
            this.description = crashCount
                ? `(${count}, ${crashCount} errors)`
                : `(${count})`;
        }

        this.iconPath = new vscode.ThemeIcon(
            (crashCount && crashCount > 0) ? (
                count !== undefined && crashCount === count ? 'error' : 'warning') :
                'symbol-class'
        );
        this.contextValue = 'result-group';
    }
}

/**
 * A single sample fuzzer result. 
 * Displayed as:
 *   [c] functionName(input) → output
 */
export class SampleItem extends vscode.TreeItem {
    constructor(
        result: RunResult | RunResultInGroup,
        functionName?: string
    ) {
        // Handle both ScoredResult and raw RunResult        
        super(SampleItem.formatSample(result, functionName), vscode.TreeItemCollapsibleState.None);

        this.iconPath = new vscode.ThemeIcon(
            result.didCrash ? 'error' : 'check'
        );
        this.contextValue = result.didCrash ? 'sample-crash' : 'sample-success';
        this.tooltip = SampleItem.formatTooltip(result, functionName);
    }

    private static formatSample(result: RunResult | RunResultInGroup, functionName?: string): string {
        const input = formatValue(result.input, result.universe);
        const fnCall = functionName ? `${functionName}(${input})` : input;
        if (result.didCrash) {
            const errorType = result.message?.split(':')[0] || 'Error';
            return `${fnCall} → ${errorType}`;
        }
        return `${fnCall} → ${result.value}`;
    }

    private static formatTooltip(result: RunResult | RunResultInGroup, functionName?: string): string {
        const lines: string[] = [];
        if (functionName) {
            lines.push(`Function: ${functionName}`);
        }
        lines.push(`Input: ${formatValue(result.input, result.universe)}`);
        if (result.didCrash) {
            lines.push(`Error: ${result.message || 'Unknown error'}`);
        } else {
            lines.push(`Output: ${result.value} (${result.typeName})`);
        }
        return lines.join('\n');
    }
}

/**
 * A message item (for empty states, etc.).
 */
export class MessageItem extends vscode.TreeItem {
    constructor(message: string, icon?: string) {
        super(message, vscode.TreeItemCollapsibleState.None);
        this.iconPath = icon ? new vscode.ThemeIcon(icon) : undefined;
        this.contextValue = 'message';
    }
}

export class FunctionsTreeProvider implements vscode.TreeDataProvider<FuzzLensTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<FuzzLensTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    // Cache of discovered functions per file
    private fileFunctions = new Map<string, FunctionInfo[]>();
    // Files with cached results (to show in tree even if not discovered yet)
    private filesWithResults = new Set<string>();

    constructor(private readonly ctx: FuzzLensContext) {
        // Watch for active editor changes to highlight current file.
        // The event may pass `undefined` when editors are closed, so
        // fall back to `vscode.window.activeTextEditor` when needed.
        vscode.window.onDidChangeActiveTextEditor(eventEditor => {
            const editor = eventEditor ?? vscode.window.activeTextEditor;
            if (editor?.document) {
                const filePath = editor.document.uri.fsPath;
                if (isSupportedFile(filePath)) {
                    this.refresh();
                }
            }
        });

        // Initial refresh if an editor is already active when the provider is created
        const initial = vscode.window.activeTextEditor;
        if (initial?.document) {
            const fp = initial.document.uri.fsPath;
            if (isSupportedFile(fp)) {
                this.refresh();
            }
        }

        // Watch for file system changes to invalidate cache
        const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
        
        // Handle file/directory deletions
        fileWatcher.onDidDelete(uri => {
            const deletedPath = uri.fsPath;
            const cache = getCache();
            
            // Check if it's a file
            if (isSupportedFile(deletedPath)) {
                cache.invalidateFile(deletedPath);
                this.fileFunctions.delete(deletedPath);
                this.filesWithResults.delete(deletedPath);
                this.refresh();
            } else {
                // Could be a directory - invalidate all cached files under this path
                const cachedFiles = cache.getCachedFiles();
                for (const cachedFile of cachedFiles) {
                    if (cachedFile.startsWith(deletedPath + path.sep)) {
                        cache.invalidateFile(cachedFile);
                        this.fileFunctions.delete(cachedFile);
                        this.filesWithResults.delete(cachedFile);
                    }
                }
                this.refresh();
            }
        });
        
        // Handle file renames/moves (appears as create after delete)
        fileWatcher.onDidCreate(uri => {
            // When a file is renamed, it appears as delete + create
            // We already handled delete above, just refresh on create
            if (isSupportedFile(uri.fsPath)) {
                this.refresh();
            }
        });

        fileWatcher.onDidChange(uri => {
            const changedPath = uri.fsPath;
            if (isSupportedFile(changedPath)) {
                const cache = getCache();
                cache.invalidateFile(changedPath);
                // Clear any previously discovered functions for this file
                this.fileFunctions.delete(changedPath);
                this.filesWithResults.delete(changedPath);

                // Re-discover functions asynchronously and refresh the view
                (async () => {
                    try {
                        const funcs = await discoverFunctionsInFile(changedPath);
                        if (funcs && funcs.length > 0) {
                            this.fileFunctions.set(changedPath, funcs);
                        } else {
                            this.fileFunctions.delete(changedPath);
                        }
                    } catch (e) {
                        // ignore discovery errors
                    }
                    this.refresh();
                })();
            }
        });

        // Populate from cache on startup
        const cache = getCache();
        for (const filePath of cache.getCachedFiles()) {
            this.filesWithResults.add(filePath);
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    setDiscoveredFunctions(filePath: string, functions: FunctionInfo[]): void {
        this.fileFunctions.set(filePath, functions);
        this.filesWithResults.add(filePath);
        this.refresh();
    }

    updateFunctionStatus(filePath: string, functionName: string, status: FunctionInfo['status'], runCount?: number): void {
        const functions = this.fileFunctions.get(filePath);
        const fn = functions?.find(f => f.name === functionName);
        if (fn) {
            fn.status = status;
            if (runCount !== undefined) {
                fn.runCount = runCount;
            }
            this.filesWithResults.add(filePath);
            this.refresh();
        }
    }

    revealFile(filePath: string): void {
        this.filesWithResults.add(filePath);
        this.refresh();
    }

    getTreeItem(element: FuzzLensTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: FuzzLensTreeItem): Promise<FuzzLensTreeItem[]> {
        if (!element) {
            // Root level: show workspace folders
            const folders = vscode.workspace.workspaceFolders;
            if (!folders || folders.length === 0) {
                return [new MessageItem('Open a workspace to get started', 'info')];
            }

            if (folders.length === 1) {
                // Single workspace: show contents directly
                return this.getFolderContents(folders[0].uri);
            }

            // Multiple workspaces: show workspace folder items
            return folders.map(folder => new WorkspaceFolderItem(folder));
        }

        if (element instanceof WorkspaceFolderItem) {
            return this.getFolderContents(element.folder.uri);
        }

        if (element instanceof FolderItem) {
            return this.getFolderContents(element.folderUri);
        }

        if (element instanceof FileItem) {
            const filePath = element.fileUri.fsPath;
            return this.getFunctionsForFile(filePath);
        }

        return [];
    }

    private async getFolderContents(folderUri: vscode.Uri): Promise<FuzzLensTreeItem[]> {
        const items: FuzzLensTreeItem[] = [];

        try {
            const entries = await vscode.workspace.fs.readDirectory(folderUri);            
            const actualFiles = new Set<string>();
            
            // Sort: folders first, then files, alphabetically
            entries.sort((a, b) => {
                if (a[1] === vscode.FileType.Directory && b[1] !== vscode.FileType.Directory) {
                    return -1;
                }
                if (a[1] !== vscode.FileType.Directory && b[1] === vscode.FileType.Directory) {
                    return 1;
                }
                return a[0].localeCompare(b[0]);
            });

            for (const [name, type] of entries) {
                if (shouldIgnoreFolder(name)) {
                    continue;
                }

                const childUri = vscode.Uri.joinPath(folderUri, name);

                if (type === vscode.FileType.Directory) {
                    const hasSupported = await this.containsSupportedFiles(childUri);
                    if (hasSupported) {
                        items.push(new FolderItem(childUri, name));
                    }
                } else if (type === vscode.FileType.File && isSupportedFile(name)) {
                    const filePath = childUri.fsPath;
                    actualFiles.add(filePath);
                    const functions = await this.getFunctionInfosForFile(filePath);
                    items.push(new FileItem(childUri, name, functions));
                }
            }
            
            // Clean up cache: remove entries for files that no longer exist in this directory
            const cache = getCache();
            const folderPath = folderUri.fsPath;
            const cachedFiles = cache.getCachedFiles();
            for (const cachedFile of cachedFiles) {
                const cachedDir = path.dirname(cachedFile);
                if (cachedDir === folderPath && !actualFiles.has(cachedFile)) {
                    // File was cached but no longer exists
                    cache.invalidateFile(cachedFile);
                    this.fileFunctions.delete(cachedFile);
                    this.filesWithResults.delete(cachedFile);
                }
            }
        } catch (error) {
            console.error('Error reading folder contents:', error);
            return [new MessageItem(`Error reading folder contents: ${error}`, 'error')];
        }

        if (items.length === 0) {
            return [new MessageItem('No supported files in this folder', 'info')];
        }

        return items;
    }

    private async containsSupportedFiles(folderUri: vscode.Uri): Promise<boolean> {
        try {
            const pattern = new vscode.RelativePattern(folderUri, SUPPORTED_FILES_GLOB);
            const files = await vscode.workspace.findFiles(pattern, null, 1);
            return files.length > 0;
        } catch {
            return false;
        }
    }

    private async getFunctionsForFile(filePath: string): Promise<FuzzLensTreeItem[]> {
        const functions = await this.getFunctionInfosForFile(filePath);

        if (functions.length === 0) {
            return [new MessageItem('Analyzing file...', 'sync~spin')];
        }

        return functions.map(fn => new FunctionItem(fn));
    }

    private async getFunctionInfosForFile(filePath: string): Promise<FunctionInfo[]> {
        let discovered = this.fileFunctions.get(filePath);
        if (!discovered) {
            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
                discovered = await discoverFunctionsInFile(filePath);
                if (discovered.length > 0) {
                    this.fileFunctions.set(filePath, discovered);
                }
            } catch (error) {
                const cache = getCache();
                cache.invalidateFile(filePath);
                this.fileFunctions.delete(filePath);
                this.filesWithResults.delete(filePath);
                return [];
            }
        }

        const cache = getCache();
        const cachedFunctions = cache.getFunctionsForFile(filePath);
        const allFunctions = [...discovered];

        for (const cached of cachedFunctions) {
            const existing = allFunctions.find(f => f.name === cached.name);
            if (!existing) {
                // Function in cache but not discovered (maybe renamed?) -> remove from cache
                cache.invalidate(filePath, cached.name);
            } else {
                existing.status = cached.status;
                existing.runCount = cached.runCount;
            }
        }

        return allFunctions;
    }
}

export class ResultsTreeProvider implements vscode.TreeDataProvider<FuzzLensTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<FuzzLensTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private currentFunction: FunctionInfo | undefined;
    private resultRoot: ResultGroup | null = null;
    private runs: RunResult[] = []; // Raw run results if no analyses available
    private runCount: number = 0;

    constructor(private readonly ctx: FuzzLensContext) { }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    setCurrentFunction(fn: FunctionInfo | undefined): void {
        this.currentFunction = fn;
        this.resultRoot = null;
        this.runs = [];
        this.runCount = 0;

        if (fn) {
            const cache = getCache();
            const cached = cache.get(fn.filePath, fn.name);
            if (cached) {
                this.resultRoot = cached.analyses.get('treeList') || null;
                this.runs = cached.runs || [];
                this.runCount = cached.runs.length;
            }
        }

        this.refresh();
    }

    /**
     * Update results from a process state (called when fuzzer finishes).
     */
    async setResults(processState: ProcessState): Promise<void> {
        if (processState.analyses) {
            this.resultRoot = processState.analyses.get('treeList') || null;
        }
        // Store raw runs in case analyses are not available
        if (processState.results) {
            this.runs = await processState.results.catch(() => []);
            this.runCount = this.runs.length;
        }
        this.refresh();
    }

    getTreeItem(element: FuzzLensTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: FuzzLensTreeItem): Thenable<FuzzLensTreeItem[]> {
        const MAX_ITEMS = 50; // Pagination limit
        
        if (!element) {
            // Root level
            if (!this.currentFunction) {
                return Promise.resolve([
                    new MessageItem('Select a function to view results', 'info')
                ]);
            }

            if (!this.resultRoot && this.runs.length === 0) {
                return Promise.resolve([
                    new MessageItem(`No results for ${this.currentFunction.name}`, 'info'),
                    new MessageItem('Click ▶ to run the fuzzer', 'play')
                ]);
            }

            if (this.resultRoot) {
                // If the root has children, show them directly (skip the root wrapper)
                if (this.resultRoot.children && this.resultRoot.children.length > 0) {
                    return Promise.resolve(
                        this.resultRoot.children.map(child => new ResultGroupItem(child, 0))
                    );
                }
                // If root has direct results, show them
                if (this.resultRoot.samples && this.resultRoot.samples.length > 0) {
                    const items: FuzzLensTreeItem[] = this.resultRoot.samples.slice(0, MAX_ITEMS).map(
                        result => new SampleItem(result, this.currentFunction?.name)
                    );
                    if (this.resultRoot.samples.length > MAX_ITEMS) {
                        items.push(new MessageItem(`... and ${this.resultRoot.samples.length - MAX_ITEMS} more`, 'ellipsis'));
                    }
                    return Promise.resolve(items);
                }
                // Root has aggregations only - show as info
                return Promise.resolve([
                    new MessageItem('Results available (grouped data only)', 'info')
                ]);
            }

            // Otherwise show ungrouped samples (raw runs) with pagination
            const items: FuzzLensTreeItem[] = this.runs.slice(0, MAX_ITEMS).map(
                run => new SampleItem(run, this.currentFunction?.name)
            );
            if (this.runs.length > MAX_ITEMS) {
                items.push(new MessageItem(`... and ${this.runs.length - MAX_ITEMS} more results`, 'ellipsis'));
            }
            return Promise.resolve(items);
        }

        if (element instanceof ResultGroupItem) {
            const items: FuzzLensTreeItem[] = [];

            if (element.group.children) {
                for (const child of element.group.children) {
                    items.push(new ResultGroupItem(child, element.depth + 1));
                }
            }

            // Paginate results within groups too (results may be undefined for parent groups)
            const results = element.group.samples || [];
            const paginatedResults = results.slice(0, MAX_ITEMS);
            for (const scored of paginatedResults) {
                items.push(new SampleItem(scored, this.currentFunction?.name));
            }
            if (results.length > MAX_ITEMS) {
                items.push(new MessageItem(`... and ${results.length - MAX_ITEMS} more`, 'ellipsis'));
            }

            return Promise.resolve(items);
        }

        return Promise.resolve([]);
    }
}
