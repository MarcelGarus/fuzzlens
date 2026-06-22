import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';

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
    seedTraces?: unknown[];
}

/**
 * A per-request handle that mimics the small slice of `ChildProcessWithoutNullStreams`
 * the rest of the extension actually uses — `stdout`/`stderr` `'data'` events,
 * the `'exit'` event, `kill()`, and a truthy `pid`. This lets the daemon back a
 * "virtual process" so `writeProcessOutputToState`, `removeFromStateOnceExited`,
 * and the command callers keep working unchanged.
 */
class RequestHandle extends EventEmitter {
    readonly stdout = makeStream();
    readonly stderr = makeStream();
    /** Truthy so callers that gate on `process.pid` before killing still fire. */
    readonly pid: number;
    private exited = false;

    constructor(id: number, private readonly onKill: () => void) {
        super();
        this.pid = id;
    }

    /** Feed a raw JSONL line to the stdout consumer (it re-parses it). */
    pushStdout(line: string): void {
        this.stdout.emit('data', line);
    }

    pushStderr(text: string): void {
        this.stderr.emit('data', text);
    }

    /** Emit the one-shot `'exit'` event, mirroring a real process exit. */
    finish(code: number): void {
        if (this.exited) {
            return;
        }
        this.exited = true;
        this.emit('exit', code, null);
    }

    kill(): boolean {
        this.onKill();
        return true;
    }
}

/** A minimal stdout/stderr stand-in: an emitter with a no-op `setEncoding`. */
function makeStream(): EventEmitter & { setEncoding: (enc?: string) => void } {
    const stream = new EventEmitter() as EventEmitter & { setEncoding: (enc?: string) => void };
    stream.setEncoding = () => { /* daemon already speaks utf8 */ };
    return stream;
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

    /** Queue a fuzzing request and return its virtual-process handle. */
    submit(request: DaemonRequest): RequestHandle {
        const id = this.nextId++;
        const handle = new RequestHandle(id, () => this.send({ id, op: 'cancel' }));
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
        let msg: { id?: number; type?: string; message?: string; code?: number };
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

        if (msg.type === 'done') {
            this.pending.delete(id);
            handle.finish(msg.code ?? 0);
        } else if (msg.type === 'error') {
            this.pending.delete(id);
            if (msg.message) {
                handle.pushStderr(msg.message + '\n');
            }
            handle.finish(1);
        } else {
            // run / analysis: re-feed the raw line; the consumer parses it. The
            // extra `id` field is ignored by that parser.
            handle.pushStdout(line + '\n');
        }
    }

    /** Mark every in-flight request as exited (non-zero) so callers clean up. */
    private failAllPending(): void {
        const handles = [...this.pending.values()];
        this.pending.clear();
        for (const handle of handles) {
            handle.finish(1);
        }
    }
}

/**
 * The daemon's `RequestHandle` implements the subset of `ChildProcessWithoutNullStreams`
 * the extension uses, but isn't the full Node type. Callers cast through this at
 * the boundary so the rest of the code keeps its existing `process` typing.
 */
export type VirtualProcess = ChildProcessWithoutNullStreams;
