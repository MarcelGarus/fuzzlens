import * as assert from 'assert';
import { FuzzLensCache, getCache, resetCache } from '../services/cache';
import { RunResult, ResultGroup, CachedResults, FunctionInfo } from '../types/state';

suite('FuzzLens Cache Test Suite', () => {
    let cache: FuzzLensCache;

    setup(() => {
        resetCache();
        cache = new FuzzLensCache(3);
    });

    teardown(() => {
        resetCache();
    });

    const createMockRun = (value: string): RunResult => ({
        type: 'run',
        universe: { objects: {} },
        input: { type: 'String', value: 'test' },
        didCrash: false,
        outputType: 'Normal',
        typeName: 'String',
        value: value,
        trace: { entries: [] }
    });

    const createMockCachedResults = (runs: RunResult[]): CachedResults => ({
        runs,
        analyses: new Map(),
        timestamp: Date.now()
    });

    test('should store and retrieve cached results', () => {
        const runs = [createMockRun('result1')];
        const cached = createMockCachedResults(runs);

        cache.set('/path/to/file.py', 'myFunction', cached);
        
        const retrieved = cache.get('/path/to/file.py', 'myFunction');
        assert.ok(retrieved);
        assert.strictEqual(retrieved.runs.length, 1);
        assert.strictEqual(retrieved.runs[0].value, 'result1');
    });

    test('should return undefined for non-existent entries', () => {
        const retrieved = cache.get('/path/to/nonexistent.py', 'noFunction');
        assert.strictEqual(retrieved, undefined);
    });

    test('should check existence with has()', () => {
        const cached = createMockCachedResults([createMockRun('test')]);
        
        assert.strictEqual(cache.has('/path/to/file.py', 'func'), false);
        cache.set('/path/to/file.py', 'func', cached);
        assert.strictEqual(cache.has('/path/to/file.py', 'func'), true);
    });

    test('should invalidate specific function', () => {
        const cached = createMockCachedResults([createMockRun('test')]);
        cache.set('/path/to/file.py', 'func1', cached);
        cache.set('/path/to/file.py', 'func2', cached);
        
        assert.strictEqual(cache.has('/path/to/file.py', 'func1'), true);
        assert.strictEqual(cache.has('/path/to/file.py', 'func2'), true);
        
        cache.invalidate('/path/to/file.py', 'func1');
        
        assert.strictEqual(cache.has('/path/to/file.py', 'func1'), false);
        assert.strictEqual(cache.has('/path/to/file.py', 'func2'), true);
    });

    test('should invalidate all functions in a file', () => {
        const cached = createMockCachedResults([createMockRun('test')]);
        cache.set('/path/to/file.py', 'func1', cached);
        cache.set('/path/to/file.py', 'func2', cached);
        cache.set('/path/to/other.py', 'func3', cached);
        
        cache.invalidateFile('/path/to/file.py');
        
        assert.strictEqual(cache.has('/path/to/file.py', 'func1'), false);
        assert.strictEqual(cache.has('/path/to/file.py', 'func2'), false);
        assert.strictEqual(cache.has('/path/to/other.py', 'func3'), true);
    });

    test('should evict LRU entries when at capacity', () => {
        const cached1 = createMockCachedResults([createMockRun('result1')]);
        const cached2 = createMockCachedResults([createMockRun('result2')]);
        const cached3 = createMockCachedResults([createMockRun('result3')]);
        const cached4 = createMockCachedResults([createMockRun('result4')]);
        
        cache.set('/file.py', 'func1', cached1);
        cache.set('/file.py', 'func2', cached2);
        cache.set('/file.py', 'func3', cached3);
        
        // All three should be present
        assert.strictEqual(cache.has('/file.py', 'func1'), true);
        assert.strictEqual(cache.has('/file.py', 'func2'), true);
        assert.strictEqual(cache.has('/file.py', 'func3'), true);
        
        // Access func1 to make it most recently used
        cache.get('/file.py', 'func1');
        
        // Add fourth entry - should evict func2 (LRU)
        cache.set('/file.py', 'func4', cached4);
        
        assert.strictEqual(cache.has('/file.py', 'func1'), true);
        assert.strictEqual(cache.has('/file.py', 'func2'), false); // Evicted
        assert.strictEqual(cache.has('/file.py', 'func3'), true);
        assert.strictEqual(cache.has('/file.py', 'func4'), true);
    });

    test('should return functions for file', () => {
        const cached = createMockCachedResults([createMockRun('test'), createMockRun('test2')]);
        cache.set('/path/to/file.py', 'func1', cached);
        cache.set('/path/to/file.py', 'func2', cached);
        cache.set('/path/to/other.py', 'func3', cached);
        
        const functions = cache.getFunctionsForFile('/path/to/file.py');
        
        assert.strictEqual(functions.length, 2);
        const names = functions.map((f: FunctionInfo) => f.name).sort();
        assert.deepStrictEqual(names, ['func1', 'func2']);
        assert.strictEqual(functions[0].status, 'has-results');
        assert.strictEqual(functions[0].runCount, 2);
    });

    test('should return cached files', () => {
        const cached = createMockCachedResults([createMockRun('test')]);
        cache.set('/path/to/file1.py', 'func', cached);
        cache.set('/path/to/file2.py', 'func', cached);
        
        const files = cache.getCachedFiles();
        
        assert.strictEqual(files.length, 2);
        assert.ok(files.includes('/path/to/file1.py'));
        assert.ok(files.includes('/path/to/file2.py'));
    });

    test('should clear all entries', () => {
        const cached = createMockCachedResults([createMockRun('test')]);
        cache.set('/file1.py', 'func1', cached);
        cache.set('/file2.py', 'func2', cached);
        
        cache.clear();
        
        assert.strictEqual(cache.getStats().size, 0);
    });

    test('should return correct stats', () => {
        const cached = createMockCachedResults([createMockRun('test')]);
        
        let stats = cache.getStats();
        assert.strictEqual(stats.size, 0);
        assert.strictEqual(stats.maxSize, 3);
        
        cache.set('/file.py', 'func', cached);
        
        stats = cache.getStats();
        assert.strictEqual(stats.size, 1);
    });

    test('getCache() should return singleton', () => {
        resetCache();
        const cache1 = getCache();
        const cache2 = getCache();
        assert.strictEqual(cache1, cache2);
    });
});
