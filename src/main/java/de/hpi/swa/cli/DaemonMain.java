package de.hpi.swa.cli;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.atomic.AtomicBoolean;

import org.graalvm.polyglot.Context;
import org.graalvm.polyglot.Engine;
import org.graalvm.polyglot.PolyglotException;

import com.google.gson.Gson;

import de.hpi.swa.cli.logger.JsonLogger;
import de.hpi.swa.coverage.CoverageInstrument;
import de.hpi.swa.serialization.GsonConfig;

/**
 * Long-lived fuzzing daemon. Holds a single warm {@link Engine} and serves
 * fuzzing requests over a newline-delimited JSON protocol on stdin/stdout, so
 * each request reuses the (expensively) initialized language runtime instead of
 * paying cold-start on every edit. See {@link FuzzCore} for the amortization.
 *
 * <p>Protocol — one JSON object per line.
 * <ul>
 *   <li>Request: a {@link FuzzRequest} with {@code op:"fuzz"} (default) and an
 *       {@code id}; or {@code op:"cancel"} carrying just the {@code id} to abort.
 *   <li>Response: {@code run} / {@code analysis} lines (tagged with the {@code id}),
 *       then a terminal {@code {"id":..,"type":"done","code":0}} or
 *       {@code {"id":..,"type":"error","message":".."}}.
 * </ul>
 *
 * <p>A dedicated worker thread runs fuzzing jobs serially (a single coverage
 * instrument is shared, so concurrent contexts would race), while the main
 * thread keeps reading stdin — this lets a {@code cancel} take effect mid-run.
 */
public class DaemonMain {

    private record Job(FuzzRequest request, AtomicBoolean cancelled) {
    }

    /** Sentinel enqueued at shutdown so the worker drains queued jobs, then stops. */
    private static final Job POISON = new Job(null, null);

    public static void main(String[] args) throws IOException, InterruptedException {
        Gson gson = GsonConfig.createGson();
        PrintStream out = new PrintStream(System.out, false, StandardCharsets.UTF_8);

        Engine engine = Engine.newBuilder().option(CoverageInstrument.ID, "true").build();
        CoverageInstrument instrument = engine.getInstruments().get(CoverageInstrument.ID)
                .lookup(CoverageInstrument.class);
        if (instrument == null) {
            throw new IllegalStateException("CoverageInstrument not found on the classpath.");
        }

        // Warm the runtime once up front so the first real request is fast too.
        warmUp(engine);

        // id -> cancellation flag for in-flight / queued jobs.
        ConcurrentHashMap<Long, AtomicBoolean> cancels = new ConcurrentHashMap<>();
        BlockingQueue<Job> queue = new LinkedBlockingQueue<>();

        Thread worker = new Thread(() -> {
            while (true) {
                Job job;
                try {
                    job = queue.take();
                } catch (InterruptedException e) {
                    return;
                }
                if (job == POISON) {
                    return;
                }
                FuzzRequest req = job.request();
                try {
                    JsonLogger logger = new JsonLogger(out, req.id);
                    FuzzCore.runFuzz(engine, instrument, req, logger, job.cancelled()::get);
                    emit(out, gson, req.id, "done", "code", 0);
                } catch (FuzzException | IOException e) {
                    emit(out, gson, req.id, "error", "message", e.getMessage());
                } catch (PolyglotException e) {
                    emit(out, gson, req.id, "error", "message", e.getMessage());
                } catch (RuntimeException e) {
                    emit(out, gson, req.id, "error", "message", String.valueOf(e.getMessage()));
                } finally {
                    if (req.id != null) {
                        cancels.remove(req.id);
                    }
                }
            }
        }, "fuzz-worker");
        worker.start();

        System.err.println("GraalFuzz daemon ready.");

        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        String line;
        while ((line = in.readLine()) != null) {
            if (line.isBlank()) {
                continue;
            }
            FuzzRequest req;
            try {
                req = gson.fromJson(line, FuzzRequest.class);
            } catch (Exception e) {
                System.err.println("Ignoring malformed request: " + e.getMessage());
                continue;
            }
            if (req == null) {
                continue;
            }

            if ("cancel".equals(req.op)) {
                // Set the flag on the main thread so it's observed mid-run.
                AtomicBoolean flag = req.id == null ? null : cancels.get(req.id);
                if (flag != null) {
                    flag.set(true);
                }
                continue;
            }

            AtomicBoolean cancelled = new AtomicBoolean(false);
            if (req.id != null) {
                cancels.put(req.id, cancelled);
            }
            queue.put(new Job(req, cancelled));
        }

        // stdin closed: let the worker finish queued jobs, then exit cleanly.
        queue.put(POISON);
        worker.join();
    }

    /** Force the language runtime to initialize so request #1 isn't the cold one. */
    private static void warmUp(Engine engine) {
        try (Context context = Context.newBuilder().engine(engine).allowAllAccess(true).build()) {
            context.eval(org.graalvm.polyglot.Source.create("python", "def _w(x):\n    return x\n"));
        } catch (Exception e) {
            System.err.println("Warm-up failed (continuing): " + e.getMessage());
        }
    }

    private static void emit(PrintStream out, Gson gson, Long id, String type, String key, Object value) {
        Map<String, Object> msg = new LinkedHashMap<>();
        if (id != null) {
            msg.put("id", id);
        }
        msg.put("type", type);
        msg.put(key, value);
        synchronized (out) {
            out.println(gson.toJson(msg));
            out.flush();
        }
    }
}
