package de.hpi.swa.cli;

import java.util.List;

import com.google.gson.annotations.SerializedName;

import de.hpi.swa.generator.Trace;

/**
 * A single fuzzing request. Doubles as the on-the-wire shape parsed from the
 * daemon's newline-delimited JSON protocol (see {@link DaemonMain}); for direct
 * CLI invocations {@link FuzzMain} builds one of these from the parsed arguments.
 */
public class FuzzRequest {

    // --- Daemon protocol envelope (null for CLI invocations) ---

    /** Correlation id echoed on every response line so the client can demux. */
    public Long id;

    /** Operation: {@code "fuzz"} (default) or {@code "cancel"}. */
    public String op;

    // --- Fuzzing parameters ---

    /** GraalVM language id (e.g. {@code "python"}, {@code "js"}). */
    public String language = "python";

    /** Inline source to fuzz (real newlines, already unescaped). */
    public String code;

    /** Alternative to {@link #code}: a path to read the source from. */
    public String filePath;

    /** Name to look up in the language bindings; if null, the eval result is fuzzed. */
    @SerializedName("function")
    public String functionName;

    /** Number of random fuzzing iterations. */
    public int iterations = 1000;

    /** Analysis query names to run after fuzzing. */
    public List<String> queries;

    /**
     * Traces (from prior runs) to replay before random fuzzing, used to quickly
     * re-confirm previously-shown examples against edited code.
     */
    public Trace[] seedTraces;
}
