package de.hpi.swa.cli;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.function.BooleanSupplier;

import org.graalvm.polyglot.Context;
import org.graalvm.polyglot.Engine;
import org.graalvm.polyglot.Source;
import org.graalvm.polyglot.Value;

import de.hpi.swa.analysis.Analysis;
import de.hpi.swa.analysis.Group;
import de.hpi.swa.cli.logger.ResultLogger;
import de.hpi.swa.coverage.Coverage;
import de.hpi.swa.coverage.CoverageInstrument;
import de.hpi.swa.generator.Pool;
import de.hpi.swa.generator.Run;
import de.hpi.swa.generator.Runner;
import de.hpi.swa.generator.Trace;

/**
 * The fuzzing core, factored out of {@link FuzzMain} so it can be driven both by
 * a one-shot CLI run and by the long-lived {@link DaemonMain}.
 *
 * <p>Each call creates a <em>fresh</em> {@link Context} from the supplied
 * {@link Engine}. The context must be fresh because every edit redefines the
 * code, but reusing the engine keeps the language runtime warm — the first
 * GraalPy context costs ~1.5s, every subsequent one ~100ms. That amortization
 * is the whole point of running this from a daemon.
 *
 * <p>Results are streamed through {@code logger} as they are produced. The
 * {@code cancelled} supplier is polled between iterations so an in-flight run
 * can be abandoned the moment a newer edit supersedes it.
 */
public final class FuzzCore {

    private FuzzCore() {
    }

    public static void runFuzz(Engine engine, CoverageInstrument instrument, FuzzRequest req,
            ResultLogger logger, BooleanSupplier cancelled) throws FuzzException, IOException {

        String language = req.language != null ? req.language : "python";

        // Build the source from inline code or a file path.
        Source source;
        if (req.code != null) {
            source = Source.newBuilder(language, req.code, "inline").build();
        } else if (req.filePath != null) {
            File file = new File(req.filePath);
            if (req.filePath.endsWith(".py")) {
                language = "python";
            } else if (req.filePath.endsWith(".js")) {
                language = "js";
            }
            System.err.println("Using " + language + " file: " + file.getPath());
            source = Source.newBuilder(language, file).build();
        } else {
            throw new FuzzException("No code or file path provided.");
        }

        // Fresh context per request, off the shared (warm) engine.
        try (Context context = Context.newBuilder().engine(engine).allowAllAccess(true).build()) {
            // A syntax/eval error surfaces as a PolyglotException; let it propagate
            // so callers can format it (CLI) or report it (daemon).
            Value evalResult = context.eval(source);

            // Determine the function to fuzz.
            Value function;
            if (req.functionName != null && !req.functionName.isEmpty()) {
                var bindings = context.getBindings(language);
                if (!bindings.hasMember(req.functionName)) {
                    throw new FuzzException("Function '" + req.functionName + "' not found in " + language
                            + " bindings. Available members: " + bindings.getMemberKeys());
                }
                function = bindings.getMember(req.functionName);
                if (!function.canExecute()) {
                    throw new FuzzException("'" + req.functionName + "' is not callable.");
                }
                System.err.println("Fuzzing function: " + req.functionName);
            } else {
                function = evalResult;
                if (function.isNull() || !function.canExecute()) {
                    throw new FuzzException("The code didn't evaluate to a function: " + function);
                }
            }

            Pool pool = new Pool();
            Random random = new Random();
            List<Run> allResults = new ArrayList<>();

            // Replay seed traces first. The tooling uses this to re-confirm the
            // examples it was already showing against freshly-edited code (a fast,
            // deterministic pass) before the slower random fuzzing below.
            if (req.seedTraces != null) {
                for (Trace seed : req.seedTraces) {
                    if (cancelled.getAsBoolean()) {
                        return;
                    }
                    if (seed == null || seed.entries.isEmpty()
                            || !(seed.entries.get(0) instanceof Trace.Call)) {
                        continue;
                    }
                    instrument.coverage = new Coverage();
                    var result = Runner.run(function, seed, random, instrument.coverage);
                    var deduplicatedResult = result.withDeduplicatedTrace();
                    pool.add(result.getTrace(), instrument.coverage);
                    allResults.add(deduplicatedResult);
                    logger.logRun(deduplicatedResult);
                }
            }

            // Random fuzzing loop.
            for (int i = 0; i < req.iterations; i++) {
                if (cancelled.getAsBoolean()) {
                    return;
                }
                var trace = pool.createNewTrace();
                instrument.coverage = new Coverage();
                var result = Runner.run(function, trace, random, instrument.coverage);
                var deduplicatedResult = result.withDeduplicatedTrace();

                pool.add(result.getTrace(), instrument.coverage);
                allResults.add(deduplicatedResult);

                logger.logRun(deduplicatedResult);
            }

            // Analysis queries.
            if (req.queries == null || req.queries.isEmpty()) {
                return;
            }
            List<String> queries = req.queries.stream().filter(Analysis.available()::contains).toList();
            if (queries.size() != req.queries.size()) {
                System.err.println("Note: some queries were not found. Requested: " + req.queries
                        + ", running: " + queries);
            }
            for (String name : queries) {
                if (cancelled.getAsBoolean()) {
                    return;
                }
                Group result = Analysis.run(name, allResults);
                logger.logAnalysis(name, result);
            }
        }
    }
}
