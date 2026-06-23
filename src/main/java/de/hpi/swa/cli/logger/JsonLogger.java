package de.hpi.swa.cli.logger;

import com.google.gson.Gson;
import com.google.gson.JsonElement;

import de.hpi.swa.analysis.Group;
import de.hpi.swa.generator.Run;
import de.hpi.swa.serialization.GsonConfig;

import java.io.PrintStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class JsonLogger implements ResultLogger {
    private final Gson gson = GsonConfig.createGson();
    private final PrintStream out;

    /**
     * Request id. Every emitted line carries it as an {@code "id"} property so the
     * daemon client can demultiplex interleaved responses.
     */
    private final Long id;

    /** Lines tagged with {@code id}, flushed eagerly so they stream. */
    public JsonLogger(PrintStream out, Long id) {
        this.out = out;
        this.id = id;
    }

    @Override
    public void logProgress(int count) {
        Map<String, Object> output = new LinkedHashMap<>();
        if (id != null) {
            output.put("id", id);
        }
        output.put("type", "progress");
        output.put("count", count);
        emit(gson.toJson(output));
    }

    @Override
    public void logAnalysis(String queryName, Group root) {
        Map<String, Object> output = new LinkedHashMap<>();
        if (id != null) {
            output.put("id", id);
        }
        output.put("type", "analysis");
        output.put("query", queryName);
        output.put("root", convert(root));
        emit(gson.toJson(output));
    }

    private void emit(String line) {
        out.println(line);
        // Flush per line so the client sees snapshots as they stream rather than
        // buffered until the request completes.
        out.flush();
    }

    private Map<String, Object> convert(Group group) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("key", group.key());
        result.put("aggregations", group.aggregations());

        if (!group.children().isEmpty()) {
            List<Map<String, Object>> children = new ArrayList<>();
            for (var child : group.children()) {
                children.add(convert(child));
            }
            result.put("children", children);
        }

        if (!group.samples().isEmpty()) {
            result.put("sampleCount", group.samples().size());
            List<JsonElement> samples = new ArrayList<>();
            for (Run run : group.samples()) {
                samples.add(gson.toJsonTree(run));
            }
            result.put("samples", samples);
        }

        return result;
    }
}
