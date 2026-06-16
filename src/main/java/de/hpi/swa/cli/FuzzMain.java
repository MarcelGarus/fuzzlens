package de.hpi.swa.cli;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Random;

import org.graalvm.polyglot.Context;
import org.graalvm.polyglot.Engine;
import org.graalvm.polyglot.PolyglotException;

import de.hpi.swa.analysis.Analysis;
import de.hpi.swa.analysis.Group;
import de.hpi.swa.cli.logger.ConsoleLogger;
import de.hpi.swa.cli.logger.JsonLogger;
import de.hpi.swa.cli.logger.ResultLogger;
import de.hpi.swa.coverage.Coverage;
import de.hpi.swa.coverage.CoverageInstrument;
import de.hpi.swa.generator.Pool;
import de.hpi.swa.generator.Run;
import de.hpi.swa.generator.Runner;

public class FuzzMain {

    public static void main(String[] args) {
        // Parse CLI options
        String language = "python";
        String code = null;
        String filePath = null;
        String functionName = null; // Optional function name to fuzz
        Boolean colorStdOut = true;
        Boolean tooling = false;
        List<String> queryNames = new ArrayList<>();
        int iterations = 1000;

        for (int i = 0; i < args.length; i++) {
            String a = args[i];
            if (a.equals("--language") || a.equals("-l")) {
                if (i + 1 < args.length)
                    language = args[++i];
            } else if (a.startsWith("--language=")) {
                language = a.substring("--language=".length());
            } else if (a.equals("--code") || a.equals("-c")) {
                if (i + 1 < args.length)
                    code = args[++i];
            } else if (a.startsWith("--code=")) {
                code = a.substring("--code=".length());
            } else if (a.equals("--file") || a.equals("-f")) {
                if (i + 1 < args.length)
                    filePath = args[++i];
            } else if (a.startsWith("--file=")) {
                filePath = a.substring("--file=".length());
            } else if (a.equals("--function") || a.equals("-fn")) {
                if (i + 1 < args.length)
                    functionName = args[++i];
            } else if (a.startsWith("--function=")) {
                functionName = a.substring("--function=".length());
            } else if (a.equals("--no-color")) {
                colorStdOut = false;
            } else if (a.equals("--tooling")) {
                tooling = true;
            } else if (a.equals("--query") || a.equals("-q")) {
                if (i + 1 < args.length) {
                    queryNames.addAll(Arrays.asList(args[++i].split(",")));
                }
            } else if (a.startsWith("--query=")) {
                queryNames.addAll(Arrays.asList(a.substring("--query=".length()).split(",")));
            } else if (a.equals("--iterations") || a.equals("-n")) {
                if (i + 1 < args.length)
                    iterations = Integer.parseInt(args[++i]);
            } else if (a.startsWith("--iterations=")) {
                iterations = Integer.parseInt(a.substring("--iterations=".length()));
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

        System.err.println("Welcome to the Fuzzer!");

        var engine = Engine.newBuilder().option(CoverageInstrument.ID, "true").build();
        var context = Context.newBuilder().engine(engine).allowAllAccess(true).build();
        var instrument = engine.getInstruments().get(CoverageInstrument.ID).lookup(CoverageInstrument.class);

        // Display available languages
        System.err.print("Available languages:");
        for (var lang : context.getEngine().getLanguages().keySet()) {
            System.err.print(" " + lang);
        }
        System.err.println();

        if (instrument == null) {
            throw new IllegalStateException(
                    "CoverageInstrument not found. Ensure it's on the classpath and correctly registered.");
        }

        // Build source
        org.graalvm.polyglot.Source source;
        try {
            if (code != null) {
                System.err.println("Using inline " + language + " code from CLI");
                // Unescape newlines and tabs passed via CLI
                code = code.replace("\\n", "\n").replace("\\t", "\t");
                source = org.graalvm.polyglot.Source.newBuilder(language, code, "cli-inline").build();
            } else if (filePath != null) {
                var file = new File(filePath);
                if (filePath.endsWith(".py")) {
                    language = "python";
                } else if (filePath.endsWith(".js")) {
                    language = "js";
                }
                System.err.println("Using " + language + " file: " + file.getPath());
                source = org.graalvm.polyglot.Source.newBuilder(language, file).build();
            } else {
                var pythonFile = new File("examples/program.py");
                System.err.println("Using default python program: " + pythonFile.getPath());
                source = org.graalvm.polyglot.Source.newBuilder("python", pythonFile).build();
            }
        } catch (IOException e) {
            System.err.println("Could not read file or build source.");
            e.printStackTrace();
            System.exit(1);
            return;
        }

        System.err.println("Running " + iterations + " iterations.\n");

        org.graalvm.polyglot.Value evalResult;
        try {
            evalResult = context.eval(source);
        } catch (PolyglotException e) {
            System.err.println("Error during execution:");
            FuzzMain.printException(e);
            System.exit(1);
            return;
        }

        // Determine the function to fuzz
        org.graalvm.polyglot.Value function;
        if (functionName != null && !functionName.isEmpty()) {
            var bindings = context.getBindings(language);
            if (!bindings.hasMember(functionName)) {
                System.err.println("Function '" + functionName + "' not found in " + language + " bindings.");
                System.err.println("Available members: " + bindings.getMemberKeys());
                System.exit(1);
            }
            function = bindings.getMember(functionName);
            if (!function.canExecute()) {
                System.err.println("'" + functionName + "' is not callable.");
                System.exit(1);
            }
            System.err.println("Fuzzing function: " + functionName);
        } else {
            function = evalResult;
            if (function.isNull() || !function.canExecute()) {
                System.err.println("Returning because the code didn't evaluate to a function:");
                System.err.println(function);
                System.exit(1);
            }
        }

        // Output
        ResultLogger logger;
        if (tooling) {
            logger = new JsonLogger();
        } else {
            logger = new ConsoleLogger(colorStdOut);
        }

        // Fuzzing loop
        var pool = new Pool();
        var random = new Random();
        List<Run> allResults = new ArrayList<>();

        for (int i = 0; i < iterations; i++) {
            var trace = pool.createNewTrace();
            instrument.coverage = new Coverage();
            var result = Runner.run(function, trace, random, instrument.coverage);
            var deduplicatedResult = result.withDeduplicatedTrace();

            // Add the entropy and its results to the pool for future selection
            pool.add(result.getTrace(), instrument.coverage);
            allResults.add(deduplicatedResult);

            logger.logRun(deduplicatedResult);
        }

        if (queryNames.isEmpty()) {
            System.err.println("No queries specified, skipping analysis phase.");
            return;
        }

        List<String> queries = queryNames.stream().filter(Analysis.available()::contains).toList();
        if (queries.isEmpty()) {
            System.err.println("Warning: No valid queries found for names: " + queryNames);
            System.err.println("Available queries: " + Analysis.available());
            return;
        }

        if (queries.size() != queryNames.size()) {
            System.err.println("Note: Some queries were not found. Requested: " + queryNames + ", Found: " + queries);
        }

        System.err.println("Running " + queries.size() + " queries: " + queries);

        // Analysis
        for (String name : queries) {
            Group result = Analysis.run(name, allResults);
            logger.logAnalysis(name, result);
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
