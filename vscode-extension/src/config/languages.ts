/**
 * Central configuration for supported languages in FuzzLens.
 * Maps VS Code language IDs to GraalVM polyglot language identifiers.
 */
import * as vscode from 'vscode';

export interface LanguageConfig {
    /** VS Code language ID (e.g., 'python', 'javascript') */
    vscodeId: string;
    /** GraalVM polyglot language ID for --language flag */
    graalId: string;
    /** File extensions (without dot) */
    extensions: string[];
    /** Display name */
    displayName: string;
}

export const SUPPORTED_LANGUAGES: LanguageConfig[] = [
    {
        vscodeId: 'python',
        graalId: 'python',
        extensions: ['py'],
        displayName: 'Python',
    },
    {
        vscodeId: 'javascript',
        graalId: 'js',
        extensions: ['js', 'mjs'],
        displayName: 'JavaScript',
    },
];

export const EXTENSION_TO_LANGUAGE: Map<string, LanguageConfig> = new Map(
    SUPPORTED_LANGUAGES.flatMap(lang => 
        lang.extensions.map(ext => [ext, lang])
    )
);

export const VSCODE_ID_TO_LANGUAGE: Map<string, LanguageConfig> = new Map(
    SUPPORTED_LANGUAGES.map(lang => [lang.vscodeId, lang])
);

export function getGraalLanguageForFile(filePath: string): string | undefined {
    const ext = filePath.split('.').pop()?.toLowerCase();
    if (!ext) {
        return undefined;
    }
    return EXTENSION_TO_LANGUAGE.get(ext)?.graalId;
}

export function isSupportedFile(filePath: string): boolean {
    const ext = filePath.split('.').pop()?.toLowerCase();
    if (!ext) {
        return false;
    }
    return EXTENSION_TO_LANGUAGE.has(ext);
}

/**
 * Get all supported file extensions (with dots).
 */
export function getSupportedExtensions(): string[] {
    return SUPPORTED_LANGUAGES.flatMap(lang => 
        lang.extensions.map(ext => `.${ext}`)
    );
}

/**
 * Glob pattern for supported files.
 */
export const SUPPORTED_FILES_GLOB = `**/*.{${SUPPORTED_LANGUAGES.flatMap(l => l.extensions).join(',')}}`;

/**
 * Cache key for when running fuzzer on entire file without specific function.
 */
export const WHOLE_FILE_KEY = '<whole-file>';

/**
 * Get a document selector for all supported languages.
 * Used for registering language-aware providers (hover, completion, etc.)
 */
export function getLanguageSelector(): vscode.DocumentSelector {
    return SUPPORTED_LANGUAGES.map(lang => ({
        language: lang.vscodeId,
        scheme: 'file'
    }));
}
