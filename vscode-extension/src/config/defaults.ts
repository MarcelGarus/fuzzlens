/**
 * Central configuration defaults for FuzzLens.
 * All default values should be defined here to avoid duplication.
 */
import * as vscode from 'vscode';

// === Inline Examples ===
export const DEFAULT_SHOW_INLINE_EXAMPLES = true;
export const DEFAULT_MAX_INLINE_EXAMPLES = 3;
export const DEFAULT_MAX_INLINE_EXAMPLE_LENGTH = 40;
export const DEFAULT_AUTO_ROTATE = true;
export const DEFAULT_ROTATION_INTERVAL_MS = 5000;

// === Fuzzer ===
export const DEFAULT_ITERATIONS = 1000;

// === Cache ===
export const DEFAULT_CACHE_SIZE = 50;

// === Explorer ===
/**
 * Folder names to ignore when scanning workspace for supported files.
 * These are typically dependency, build output, or hidden folders.
 */
export const DEFAULT_IGNORED_FOLDERS = [
    'node_modules',
    '__pycache__',
    'venv',
    '.venv',
    'dist',
    'build',
    'target',
    'out',
    '.git',
    '.svn',
    '.hg',
    'coverage',
    '.nyc_output',
    '.pytest_cache',
    '.mypy_cache',
    'egg-info',
];

// === Configuration Getters ===

export function getShowInlineExamples(): boolean {
    return vscode.workspace.getConfiguration('fuzzlens').get('showInlineExamples', DEFAULT_SHOW_INLINE_EXAMPLES);
}

export function getMaxInlineExamples(): number {
    return vscode.workspace.getConfiguration('fuzzlens').get('maxInlineExamples', DEFAULT_MAX_INLINE_EXAMPLES);
}

export function getMaxInlineExampleLength(): number {
    return vscode.workspace.getConfiguration('fuzzlens').get('maxInlineExampleLength', DEFAULT_MAX_INLINE_EXAMPLE_LENGTH);
}

export function getAutoRotate(): boolean {
    return vscode.workspace.getConfiguration('fuzzlens').get('inlineExamples.autoRotate', DEFAULT_AUTO_ROTATE);
}

export function getRotationInterval(): number {
    return vscode.workspace.getConfiguration('fuzzlens').get('inlineExamples.rotationInterval', DEFAULT_ROTATION_INTERVAL_MS);
}

export function getIterations(): number {
    return vscode.workspace.getConfiguration('fuzzlens').get('iterations', DEFAULT_ITERATIONS);
}

export function getCacheSize(): number {
    return vscode.workspace.getConfiguration('fuzzlens').get('cacheSize', DEFAULT_CACHE_SIZE);
}

export function getIgnoredFolders(): string[] {
    return vscode.workspace.getConfiguration('fuzzlens').get('explorer.ignoredFolders', DEFAULT_IGNORED_FOLDERS);
}

/**
 * Check if a folder name should be ignored based on config.
 */
export function shouldIgnoreFolder(name: string): boolean {
    if (name.startsWith('.')) {
        return true;
    }
    return getIgnoredFolders().includes(name);
}
