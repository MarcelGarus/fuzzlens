package de.hpi.swa.serialization;

import com.google.gson.*;

import com.oracle.truffle.api.source.SourceSection;

import de.hpi.swa.generator.Run;
import de.hpi.swa.generator.Runner;
import de.hpi.swa.generator.Trace;
import de.hpi.swa.generator.Universe;
import de.hpi.swa.generator.Value;

import java.lang.reflect.Type;
import java.util.List;

public class RunResultAdapter implements JsonSerializer<Run>, JsonDeserializer<Run> {

    @Override
    public JsonElement serialize(Run src, Type typeOfSrc, JsonSerializationContext context) {
        JsonObject result = new JsonObject();
        
        result.add("universe", context.serialize(src.universe()));
        result.add("input", context.serialize(src.input(), Value.class));
        result.add("didCrash", context.serialize(src.didCrash()));

        switch (src.output()) {
            case Runner.FunctionResult.Normal normal -> {
                result.addProperty("outputType", "Normal");
                result.addProperty("typeName", normal.typeName());
                result.addProperty("value", normal.value());
            }
            case Runner.FunctionResult.Crash crash -> {
                result.addProperty("outputType", "Crash");
                result.addProperty("message", crash.message());
                result.add("stackTrace", context.serialize(crash.stackTrace()));
            }
        }

        result.add("trace", context.serialize(src.trace()));

        // The (1-based) source lines of the fuzzed code that this run executed.
        // Internal/library sources are excluded so this stays the user's own
        // lines — enough for the tooling to tell which return statement a run
        // reached.
        if (src.coverage() != null) {
            List<Integer> coveredLines = src.coverage().getCovered().stream()
                    .filter(s -> s.getSource() != null && !s.getSource().isInternal())
                    .map(SourceSection::getStartLine)
                    .distinct()
                    .sorted()
                    .toList();
            result.add("coveredLines", context.serialize(coveredLines));
        }

        return result;
    }

    @Override
    public Run deserialize(JsonElement json, Type typeOfT, JsonDeserializationContext context) 
            throws JsonParseException {
        JsonObject obj = json.getAsJsonObject();
        // deserialize normally except for output
        
        Universe universe = context.deserialize(obj.get("universe"), de.hpi.swa.generator.Universe.class);
        Value input = context.deserialize(obj.get("input"), Value.class);
        Trace trace = context.deserialize(obj.get("trace"), Trace.class);
        Runner.FunctionResult output = switch (obj.get("outputType").getAsString()) {
            case "Normal" -> new Runner.FunctionResult.Normal(
                obj.get("typeName").getAsString(),
                obj.get("value").getAsString()
            );
            case "Crash" -> new Runner.FunctionResult.Crash(
                obj.get("message").getAsString(),
                context.deserialize(obj.get("stackTrace"), java.util.List.class)
            );
            default -> throw new JsonParseException("Unknown output type");
        };
        return new Run(universe, input, output, trace, new de.hpi.swa.coverage.Coverage());
    }
}
