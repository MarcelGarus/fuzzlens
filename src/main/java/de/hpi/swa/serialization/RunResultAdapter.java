package de.hpi.swa.serialization;

import com.google.gson.*;

import de.hpi.swa.generator.Run;
import de.hpi.swa.generator.Runner;
import de.hpi.swa.generator.Trace;
import de.hpi.swa.generator.Universe;
import de.hpi.swa.generator.Value;

import java.lang.reflect.Type;

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
