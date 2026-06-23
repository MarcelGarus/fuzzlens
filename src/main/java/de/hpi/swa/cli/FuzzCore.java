package de.hpi.swa.cli;

import java.io.File;
import java.io.IOException;
import java.time.Duration;
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
import de.hpi.swa.analysis.ReturnExamples;
import de.hpi.swa.cli.logger.ResultLogger;
import de.hpi.swa.coverage.Coverage;
import de.hpi.swa.coverage.CoverageInstrument;
import de.hpi.swa.generator.Minimizer;
import de.hpi.swa.generator.Pool;
import de.hpi.swa.generator.Run;
import de.hpi.swa.generator.Runner;
import de.hpi.swa.generator.Trace;

/**
 * The fuzzing core, driven by the long-lived {@link DaemonMain}.
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

    /** Upper bound on traces returned for seeding a later run (see {@link Pool#bestTraces}). */
    private static final int MAX_SEED_TRACES = 64;

    /** Fixed wall-clock budget for one fuzzed function invocation. */
    private static final Duration EXECUTION_TIMEOUT = Duration.ofMillis(250);

    private FuzzCore() {
    }

    /**
     * Runs the fuzzer and returns the curated traces worth replaying as seeds on a
     * later run of the same function (empty if cancelled early). The daemon keeps
     * these per function and feeds them back in via {@code req.seedTraces}.
     */
    public static List<Trace> runFuzz(Engine engine, CoverageInstrument instrument, FuzzRequest req,
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
        String sourceText = source.getCharacters().toString();

        // Which queries to run. `returnExamples` is a source-aware curation handled
        // here rather than as a pure Analysis query, so it's split out.
        boolean returnExamplesWanted = req.queries != null && req.queries.contains(ReturnExamples.QUERY);
        List<String> queries = req.queries == null ? List.of()
                : req.queries.stream().filter(Analysis.available()::contains).toList();

        // Emit ~10 curated snapshots over the run, regardless of iteration count.
        int snapshotEvery = Math.max(50, req.iterations / 10);
        int sinceSnapshot = 0;

        // Fresh context per request, off the shared (warm) engine.
        try (Context context = Context.newBuilder().engine(engine).allowAllAccess(true).build()) {
            // A syntax/eval error surfaces as a PolyglotException; let it propagate
            // so the daemon can report it as an error.
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

            // Replay seed traces first to re-confirm the examples already shown
            // against freshly-edited code (a fast, deterministic pass) before the
            // slower random fuzzing below.
            if (req.seedTraces != null) {
                for (Trace seed : req.seedTraces) {
                    if (cancelled.getAsBoolean()) {
                        return List.of();
                    }
                    if (seed == null || seed.entries.isEmpty()
                            || !(seed.entries.get(0) instanceof Trace.Call)) {
                        continue;
                    }
                    instrument.coverage = new Coverage();
                    var result = Runner.run(function, seed, random, instrument.coverage, context, EXECUTION_TIMEOUT);
                    var deduplicatedResult = result.withDeduplicatedTrace();
                    if (!didTimeout(result)) {
                        pool.add(result.getTrace(), instrument.coverage);
                    }
                    allResults.add(deduplicatedResult);
                }
            }

            // Random fuzzing loop.
            for (int i = 0; i < req.iterations; i++) {
                if (cancelled.getAsBoolean()) {
                    return List.of();
                }
                var trace = pool.createNewTrace();
                instrument.coverage = new Coverage();
                var result = Runner.run(function, trace, random, instrument.coverage, context, EXECUTION_TIMEOUT);
                var deduplicatedResult = result.withDeduplicatedTrace();

                if (!didTimeout(result)) {
                    pool.add(result.getTrace(), instrument.coverage);
                }
                allResults.add(deduplicatedResult);

                if (++sinceSnapshot >= snapshotEvery) {
                    sinceSnapshot = 0;
                    emitSnapshot(logger, sourceText, allResults, queries, returnExamplesWanted, null, null);
                }
            }

            // Final snapshot reflecting every result. Here — and only here, since it
            // re-runs the function many times — displayed examples are minimized to
            // smaller inputs that still represent the same curated behaviour.
            Minimizer minimizer = new Minimizer(function, instrument, context, EXECUTION_TIMEOUT);
            ReturnExamples.ExampleMinimizer returnMinimizer = (run, line) -> minimizer.minimize(run,
                    candidate -> !candidate.didCrash() && ReturnExamples.coveredUserLines(candidate).contains(line));
            Analysis.SampleMinimizer sampleMinimizer = (run, invariant) -> didTimeout(run) ? run
                    : minimizer.minimize(run, invariant);
            emitSnapshot(logger, sourceText, allResults, queries, returnExamplesWanted, returnMinimizer,
                    sampleMinimizer);

            return pool.bestTraces(MAX_SEED_TRACES);
        }
    }

    /** Emit one curated snapshot: progress count, the return-line examples, then each analysis. */
    private static void emitSnapshot(ResultLogger logger, String sourceText, List<Run> allResults,
            List<String> queries, boolean returnExamplesWanted, ReturnExamples.ExampleMinimizer returnMinimizer,
            Analysis.SampleMinimizer sampleMinimizer) {
        logger.logProgress(allResults.size());
        if (returnExamplesWanted) {
            logger.logAnalysis(ReturnExamples.QUERY, ReturnExamples.curate(sourceText, allResults, returnMinimizer));
        }
        for (String name : queries) {
            logger.logAnalysis(name, Analysis.run(name, allResults, sampleMinimizer));
        }
    }

    private static boolean didTimeout(Run run) {
        return run.getOutput() instanceof Runner.FunctionResult.Crash crash
                && crash.message() != null
                && crash.message().startsWith("TimeoutError:");
    }
}
