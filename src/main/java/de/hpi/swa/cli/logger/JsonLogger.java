package de.hpi.swa.cli.logger;

import com.google.gson.Gson;
import com.google.gson.JsonElement;

import de.hpi.swa.analysis.Group;
import de.hpi.swa.generator.Run;
import de.hpi.swa.serialization.GsonConfig;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class JsonLogger implements ResultLogger {
    private final Gson gson = GsonConfig.createGson();

    @Override
    public void logRun(Run result) {
        var jsonElement = gson.toJsonTree(result);
        if (jsonElement.isJsonObject()) {
            jsonElement.getAsJsonObject().addProperty("type", "run");
        }
        System.out.println(gson.toJson(jsonElement));
    }

    @Override
    public void logAnalysis(String queryName, Group root) {
        var output = Map.of(
                "type", "analysis",
                "query", queryName,
                "root", convert(root));
        System.out.println(gson.toJson(output));
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
