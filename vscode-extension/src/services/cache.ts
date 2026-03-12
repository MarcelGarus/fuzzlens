import { CachedResults, FunctionInfo } from '../types/state';

/**
 * LRU Cache for fuzzer results.
 * Stores results keyed by "filePath:functionName".
 */
export class FuzzLensCache {
    private cache: Map<string, CachedResults> = new Map();
    private keyToFile: Map<string, { filePath: string; functionName: string }> = new Map();
    private maxSize: number;
    private accessOrder: string[] = [];

    constructor(maxSize: number = 50) {
        this.maxSize = maxSize;
    }

    private makeKey(filePath: string, functionName: string): string {
        return `${filePath}:${functionName}`;
    }

    get(filePath: string, functionName: string): CachedResults | undefined {
        const key = this.makeKey(filePath, functionName);
        const result = this.cache.get(key);
        if (result) {
            // Move to end of access order (most recently used)
            this.accessOrder = this.accessOrder.filter(k => k !== key);
            this.accessOrder.push(key);
        }
        return result;
    }

    set(
        filePath: string,
        functionName: string,
        results: CachedResults
    ): void {
        const key = this.makeKey(filePath, functionName);

        // Evict LRU if at capacity
        while (this.cache.size >= this.maxSize && this.accessOrder.length > 0) {
            const lruKey = this.accessOrder.shift();
            if (lruKey) {
                this.cache.delete(lruKey);
                this.keyToFile.delete(lruKey);
            }
        }

        this.cache.set(key, results);
        this.keyToFile.set(key, { filePath, functionName });
        this.accessOrder = this.accessOrder.filter(k => k !== key);
        this.accessOrder.push(key);
    }

    has(filePath: string, functionName: string): boolean {
        return this.cache.has(this.makeKey(filePath, functionName));
    }

    invalidate(filePath: string, functionName: string): void {
        const key = this.makeKey(filePath, functionName);
        this.cache.delete(key);
        this.keyToFile.delete(key);
        this.accessOrder = this.accessOrder.filter(k => k !== key);
    }

    invalidateFile(filePath: string): void {
        const keysToDelete: string[] = [];
        for (const key of this.cache.keys()) {
            if (key.startsWith(filePath + ':')) {
                keysToDelete.push(key);
            }
        }
        for (const key of keysToDelete) {
            this.cache.delete(key);
            this.keyToFile.delete(key);
            this.accessOrder = this.accessOrder.filter(k => k !== key);
        }
    }

    getFunctionsForFile(filePath: string): FunctionInfo[] {
        const functions: FunctionInfo[] = [];
        for (const [key, cached] of this.cache.entries()) {
            if (key.startsWith(filePath + ':')) {
                const info = this.keyToFile.get(key);
                if (info) {
                    functions.push({
                        name: info.functionName,
                        filePath: info.filePath,
                        status: 'has-results',
                        runCount: cached.runs.length
                    });
                }
            }
        }
        return functions;
    }

    getCachedFunctionNames(filePath: string): string[] {
        const names: string[] = [];
        for (const key of this.cache.keys()) {
            if (key.startsWith(filePath + ':')) {
                const functionName = key.substring(filePath.length + 1);
                names.push(functionName);
            }
        }
        return names;
    }

    getCachedFiles(): string[] {
        const files = new Set<string>();
        for (const key of this.cache.keys()) {
            const colonIndex = key.lastIndexOf(':');
            if (colonIndex > 0) {
                files.add(key.substring(0, colonIndex));
            }
        }
        return Array.from(files);
    }

    clear(): void {
        this.cache.clear();
        this.keyToFile.clear();
        this.accessOrder = [];
    }

    getStats(): { size: number; maxSize: number } {
        return {
            size: this.cache.size,
            maxSize: this.maxSize
        };
    }
}

// Singleton instance
let cacheInstance: FuzzLensCache | undefined;

export function getCache(): FuzzLensCache {
    if (!cacheInstance) {
        cacheInstance = new FuzzLensCache();
    }
    return cacheInstance;
}

export function resetCache(): void {
    cacheInstance = undefined;
}
