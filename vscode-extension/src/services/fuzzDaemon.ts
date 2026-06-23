import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as path from 'path';
import { FuzzRunHandle, ResultGroup } from '../types/state';

/**
 * Parameters for a single daemon fuzzing request. Mirrors the Java `FuzzRequest`
 * wire shape (see DaemonMain), minus the protocol envelope (`id`/`op`), which
 * the daemon client fills in.
 */
export interface DaemonRequest {
    language: string;
    /** Inline source (the live editor buffer). Preferred over `file` when set. */
    code?: string;
    /** Absolute path read by the daemon when `code` is absent. */
    file?: string;
    function?: string;
    iterations: number;
    queries: string[];
}

/**
 * One in-flight request. Holds the typed subscriber lists and dispatches the
 * daemon's parsed responses straight to them — no `ChildProcess` impersonation,
 * no re-serializing results back into JSONL for the consumer to re-parse.
 */
class RequestHandle implements FuzzRunHandle {
    private readonly progressCbs: ((count: number) => void)[] = [];
    private readonly analysisCbs: ((query: string, root: ResultGroup) => void)[] = [];
    private readonly doneCbs: ((code: number, errorMessage?: string) => void)[] = [];
    private done = false;

    constructor(private readonly onCancel: () => void) { }

    onProgress(cb: (count: number) => void): void { this.progressCbs.push(cb); }
    onAnalysis(cb: (query: string, root: ResultGroup) => void): void { this.analysisCbs.push(cb); }
    onDone(cb: (code: number, errorMessage?: string) => void): void {
        // A late subscriber on an already-finished run still gets notified.
        if (this.done) { cb(this.finalCode, this.finalError); return; }
        this.doneCbs.push(cb);
    }

    cancel(): void { this.onCancel(); }

    // --- driven by FuzzDaemon ---
    private finalCode = 0;
    private finalError: string | undefined;

    emitProgress(count: number): void {
        for (const cb of this.progressCbs) { cb(count); }
    }
    emitAnalysis(query: string, root: ResultGroup): void {
        for (const cb of this.analysisCbs) { cb(query, root); }
    }
    finish(code: number, errorMessage?: string): void {
        if (this.done) { return; }
        this.done = true;
        this.finalCode = code;
        this.finalError = errorMessage;
        for (const cb of this.doneCbs) { cb(code, errorMessage); }
    }
}

/**
 * Long-lived client for the GraalFuzz daemon. Spawns a single `graalfuzz-daemon`
 * process (lazily, respawned after a crash) and multiplexes many fuzzing requests
 * over its stdin/stdout, demultiplexing responses back to per-request handles by id.
 *
 * One instance per extension, keyed by extension path.
 */
export class FuzzDaemon {
    private static instances = new Map<string, FuzzDaemon>();

    static get(extensionPath: string): FuzzDaemon {
        let instance = FuzzDaemon.instances.get(extensionPath);
        if (!instance) {
            instance = new FuzzDaemon(extensionPath);
            FuzzDaemon.instances.set(extensionPath, instance);
        }
        return instance;
    }

    /** Tear down every daemon (extension deactivation). */
    static disposeAll(): void {
        for (const instance of FuzzDaemon.instances.values()) {
            instance.dispose();
        }
        FuzzDaemon.instances.clear();
    }

    private proc?: ChildProcessWithoutNullStreams;
    private lineBuffer = '';
    private nextId = 1;
    private readonly pending = new Map<number, RequestHandle>();

    private constructor(private readonly extensionPath: string) { }

    /** Queue a fuzzing request and return its typed run handle. */
    submit(request: DaemonRequest): FuzzRunHandle {
        const id = this.nextId++;
        const handle = new RequestHandle(() => this.send({ id, op: 'cancel' }));
        this.pending.set(id, handle);
        this.ensureStarted();
        this.send({ id, op: 'fuzz', ...request });
        return handle;
    }

    dispose(): void {
        const proc = this.proc;
        this.proc = undefined;
        // Fail any outstanding requests so their state is cleaned up.
        this.failAllPending();
        proc?.kill?.();
    }

    private ensureStarted(): void {
        if (this.proc) {
            return;
        }
        const isWin = process.platform === 'win32';
        const script = isWin
            ? path.join(this.extensionPath, '..', 'graalfuzz-daemon.cmd')
            : path.join(this.extensionPath, '..', 'graalfuzz-daemon.sh');

        const proc = spawn(script, [], {
            stdio: 'pipe',
            shell: isWin,
            cwd: path.join(this.extensionPath, '..'),
        });
        this.proc = proc;
        this.lineBuffer = '';

        proc.stdout.setEncoding('utf8');
        proc.stdout.on('data', (chunk: string) => {
            // Ignore output from a process we've already replaced.
            if (proc !== this.proc) {
                return;
            }
            this.onStdout(chunk);
        });

        // The daemon logs diagnostics to stderr; surface them on the console.
        proc.stderr.setEncoding('utf8');
        proc.stderr.on('data', (chunk: string) => {
            console.error(`[graalfuzz-daemon] ${chunk}`);
        });

        proc.on('exit', (code) => {
            if (proc !== this.proc) {
                return;
            }
            console.error(`[graalfuzz-daemon] exited with code ${code}; will respawn on next request`);
            this.proc = undefined;
            this.failAllPending();
        });

        proc.on('error', (err) => {
            if (proc !== this.proc) {
                return;
            }
            console.error(`[graalfuzz-daemon] failed to start: ${err.message}`);
            this.proc = undefined;
            this.failAllPending();
        });
    }

    private send(message: Record<string, unknown>): void {
        try {
            this.proc?.stdin.write(JSON.stringify(message) + '\n');
        } catch (err) {
            console.error(`[graalfuzz-daemon] write failed: ${(err as Error).message}`);
        }
    }

    /** Line-buffer the daemon's stdout and route each complete line by id. */
    private onStdout(chunk: string): void {
        this.lineBuffer += chunk;
        let newlineIndex: number;
        while ((newlineIndex = this.lineBuffer.indexOf('\n')) >= 0) {
            const line = this.lineBuffer.slice(0, newlineIndex);
            this.lineBuffer = this.lineBuffer.slice(newlineIndex + 1);
            if (line.trim()) {
                this.routeLine(line);
            }
        }
    }

    private routeLine(line: string): void {
        let msg: { id?: number; type?: string; query?: string; root?: ResultGroup; message?: string; code?: number; count?: number };
        try {
            msg = JSON.parse(line);
        } catch (err) {
            console.error(`[graalfuzz-daemon] unparseable line: ${line}`);
            return;
        }
        const id = msg.id;
        if (id === undefined) {
            return;
        }
        const handle = this.pending.get(id);
        if (!handle) {
            // Stale (e.g. cancelled and already finished) — drop it.
            return;
        }

        switch (msg.type) {
            case 'progress':
                handle.emitProgress(msg.count ?? 0);
                break;
            case 'analysis':
                handle.emitAnalysis(msg.query || 'default', msg.root as ResultGroup);
                break;
            case 'done':
                this.pending.delete(id);
                handle.finish(msg.code ?? 0);
                break;
            case 'error':
                this.pending.delete(id);
                handle.finish(1, msg.message);
                break;
        }
    }

    /** Mark every in-flight request as failed so callers clean up. */
    private failAllPending(): void {
        const handles = [...this.pending.values()];
        this.pending.clear();
        for (const handle of handles) {
            handle.finish(1, 'daemon stopped');
        }
    }
}
