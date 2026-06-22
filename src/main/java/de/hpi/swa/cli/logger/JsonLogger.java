package de.hpi.swa.cli.logger;

import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

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
     * Optional request id. When set, every emitted line carries an {@code "id"}
     * property so a daemon client can demultiplex interleaved responses; when
     * null (the CLI case) lines are untagged, preserving the original format.
     */
    private final Long id;

    /** CLI constructor: untagged lines to {@code System.out}. */
    public JsonLogger() {
        this(System.out, null);
    }

    /** Daemon constructor: lines tagged with {@code id}, flushed eagerly so they stream. */
    public JsonLogger(PrintStream out, Long id) {
        this.out = out;
        this.id = id;
    }

    @Override
    public void logRun(Run result) {
        var jsonElement = gson.toJsonTree(result);
        if (jsonElement.isJsonObject()) {
            jsonElement.getAsJsonObject().addProperty("type", "run");
            tag(jsonElement.getAsJsonObject());
        }
        emit(gson.toJson(jsonElement));
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

    private void tag(JsonObject obj) {
        if (id != null) {
            obj.addProperty("id", id);
        }
    }

    private void emit(String line) {
        out.println(line);
        // Flush per line so the client sees runs/analyses as they stream rather
        // than buffered until the request completes.
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
