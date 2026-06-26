package de.hpi.swa.cli;

import java.util.List;

import com.google.gson.annotations.SerializedName;

// A single fuzzing request, parsed from the daemon's newline-delimited JSON protocol.
public class FuzzRequest {
    public Long id;
    public String op; // "fuzz" or "cancel"

    public String language = "python"; // GraalVM language id

    public String code;

    @SerializedName("file")
    public String filePath;

    // Name to look up in the language bindings; if null, the eval result is fuzzed.
    @SerializedName("function")
    public String functionName;

    public int iterations = 1000;

    // Analysis query names to run after fuzzing.
    public List<String> queries;
}
