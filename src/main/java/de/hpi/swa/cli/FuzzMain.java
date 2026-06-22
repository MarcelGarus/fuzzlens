package de.hpi.swa.cli;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import org.graalvm.polyglot.Engine;
import org.graalvm.polyglot.PolyglotException;

import de.hpi.swa.analysis.Analysis;
import de.hpi.swa.cli.logger.ConsoleLogger;
import de.hpi.swa.cli.logger.JsonLogger;
import de.hpi.swa.cli.logger.ResultLogger;
import de.hpi.swa.coverage.CoverageInstrument;
import de.hpi.swa.generator.Trace;
import de.hpi.swa.serialization.GsonConfig;

public class FuzzMain {

    public static void main(String[] args) {
        // Parse CLI options into a request.
        FuzzRequest req = new FuzzRequest();
        req.queries = new ArrayList<>();
        Boolean colorStdOut = true;
        Boolean tooling = false;
        String seedTracesJson = null; // Optional JSON array of traces to replay first

        for (int i = 0; i < args.length; i++) {
            String a = args[i];
            if (a.equals("--language") || a.equals("-l")) {
                if (i + 1 < args.length)
                    req.language = args[++i];
            } else if (a.startsWith("--language=")) {
                req.language = a.substring("--language=".length());
            } else if (a.equals("--code") || a.equals("-c")) {
                if (i + 1 < args.length)
                    req.code = args[++i];
            } else if (a.startsWith("--code=")) {
                req.code = a.substring("--code=".length());
            } else if (a.equals("--file") || a.equals("-f")) {
                if (i + 1 < args.length)
                    req.filePath = args[++i];
            } else if (a.startsWith("--file=")) {
                req.filePath = a.substring("--file=".length());
            } else if (a.equals("--function") || a.equals("-fn")) {
                if (i + 1 < args.length)
                    req.functionName = args[++i];
            } else if (a.startsWith("--function=")) {
                req.functionName = a.substring("--function=".length());
            } else if (a.equals("--no-color")) {
                colorStdOut = false;
            } else if (a.equals("--tooling")) {
                tooling = true;
            } else if (a.equals("--query") || a.equals("-q")) {
                if (i + 1 < args.length) {
                    req.queries.addAll(Arrays.asList(args[++i].split(",")));
                }
            } else if (a.startsWith("--query=")) {
                req.queries.addAll(Arrays.asList(a.substring("--query=".length()).split(",")));
            } else if (a.equals("--iterations") || a.equals("-n")) {
                if (i + 1 < args.length)
                    req.iterations = Integer.parseInt(args[++i]);
            } else if (a.startsWith("--iterations=")) {
                req.iterations = Integer.parseInt(a.substring("--iterations=".length()));
            } else if (a.equals("--seed-traces")) {
                if (i + 1 < args.length)
                    seedTracesJson = args[++i];
            } else if (a.startsWith("--seed-traces=")) {
                seedTracesJson = a.substring("--seed-traces=".length());
            } else if (a.equals("--list-queries")) {
                System.out.println("Available queries:");
                for (String name : Analysis.available()) {
                    System.out.println("  " + name);
                }
                return;
            } else if (a.equals("--help") || a.equals("-h")) {
                printHelp();
                return;
            }
        }

        // CLI-specific massaging: unescape inline code, parse seed traces, and
        // fall back to the bundled demo program when nothing was supplied.
        if (req.code != null) {
            req.code = req.code.replace("\\n", "\n").replace("\\t", "\t");
            System.err.println("Using inline " + req.language + " code from CLI");
        } else if (req.filePath == null) {
            req.filePath = "examples/program.py";
            System.err.println("Using default python program: " + req.filePath);
        }
        if (seedTracesJson != null && !seedTracesJson.isBlank()) {
            try {
                req.seedTraces = GsonConfig.createGson().fromJson(seedTracesJson, Trace[].class);
            } catch (Exception e) {
                System.err.println("Failed to parse seed traces: " + e.getMessage());
            }
        }

        System.err.println("Welcome to the Fuzzer!");

        var engine = Engine.newBuilder().option(CoverageInstrument.ID, "true").build();
        var instrument = engine.getInstruments().get(CoverageInstrument.ID).lookup(CoverageInstrument.class);
        if (instrument == null) {
            throw new IllegalStateException(
                    "CoverageInstrument not found. Ensure it's on the classpath and correctly registered.");
        }

        // Display available languages (read off the engine; building a probe
        // context with a different host-access config than FuzzCore's would
        // break engine sharing).
        System.err.print("Available languages:");
        for (var lang : engine.getLanguages().keySet()) {
            System.err.print(" " + lang);
        }
        System.err.println();

        System.err.println("Running " + req.iterations + " iterations.\n");

        ResultLogger logger = tooling ? new JsonLogger() : new ConsoleLogger(colorStdOut);

        try {
            FuzzCore.runFuzz(engine, instrument, req, logger, () -> false);
        } catch (FuzzException e) {
            System.err.println(e.getMessage());
            System.exit(1);
        } catch (PolyglotException e) {
            System.err.println("Error during execution:");
            printException(e);
            System.exit(1);
        } catch (IOException e) {
            System.err.println("Could not read file or build source.");
            e.printStackTrace();
            System.exit(1);
        }
    }

    private static void printHelp() {
        System.out.println("GraalFuzz - Fuzzer for Polyglot Programs");
        System.out.println();
        System.out.println("Usage: graalfuzz [options]");
        System.out.println();
        System.out.println("Options:");
        System.out.println("  -l, --language=LANG    Target language (default: python)");
        System.out.println("  -f, --file=PATH        Path to source file");
        System.out.println("  -c, --code=CODE        Inline code to fuzz");
        System.out.println("  -fn, --function=NAME   Function name to fuzz (looks up from bindings)");
        System.out.println("  -q, --query=NAMES      Comma-separated query names (default: detailed)");
        System.out.println("  -n, --iterations=N     Number of fuzzing iterations (default: 1000)");
        System.out.println("  --tooling              Enable JSON output for tooling");
        System.out.println("  --no-color             Disable colored output");
        System.out.println("  --list-queries         List available query names");
        System.out.println("  -h, --help             Show this help message");
        System.out.println();
        System.out.println("Available queries:");
        for (String name : Analysis.available()) {
            System.out.println("  " + name);
        }
    }

    static void printException(Throwable e) {
        if (e instanceof PolyglotException) {
            runtimeError((PolyglotException) e);
        } else {
            System.err.println("Error: " + e.getMessage());
        }
    }

    static void runtimeError(PolyglotException error) {
        if (error.isSyntaxError()) {
            System.err.println(error.getMessage());
        } else if (error.isGuestException()) {
            org.graalvm.polyglot.SourceSection sourceLocation = error.getSourceLocation();
            if (sourceLocation != null) {
                System.err.println("[line " + sourceLocation.getStartLine() + "] " + "Error: " + error.getMessage());
            } else {
                System.err.println("Error: " + error.getMessage());
                error.printStackTrace();
            }
        } else {
            System.err.println(error.getMessage());
            error.printStackTrace();
        }
    }
}
