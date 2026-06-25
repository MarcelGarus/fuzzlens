package de.hpi.swa.serialization;

import com.google.gson.*;

import de.hpi.swa.generator.Trace;
import de.hpi.swa.generator.Value;

import java.lang.reflect.Type;

public class TraceEntryAdapter implements JsonSerializer<Trace.TraceEntry>, JsonDeserializer<Trace.TraceEntry> {

    @Override
    public JsonElement serialize(Trace.TraceEntry entry, Type typeOfSrc, JsonSerializationContext context) {
        JsonObject result = new JsonObject();
        
        switch (entry) {
            case Trace.Call call -> {
                result.addProperty("type", "Call");
                // Serialize each argument as Value (not the runtime record type) so
                // the type tag is emitted and the trace can be deserialized for replay.
                JsonArray args = new JsonArray();
                for (Value arg : call.args()) {
                    args.add(context.serialize(arg, Value.class));
                }
                result.add("args", args);
            }
            case Trace.QueryMember query -> {
                result.addProperty("type", "QueryMember");
                result.add("id", context.serialize(query.id()));
                result.addProperty("key", query.key());
            }
            case Trace.Member member -> {
                result.addProperty("type", "Member");
                result.add("id", context.serialize(member.id()));
                result.addProperty("key", member.key());
                result.add("value", context.serialize(member.value(), Value.class));
            }
            case Trace.Return ret -> {
                result.addProperty("type", "Return");
                result.addProperty("typeName", ret.typeName());
                result.addProperty("value", ret.value());
            }
            case Trace.Crash crash -> {
                result.addProperty("type", "Crash");
                result.addProperty("message", crash.message());
            }
        }
        
        return result;
    }

    @Override
    public Trace.TraceEntry deserialize(JsonElement json, Type typeOfT, JsonDeserializationContext context) 
            throws JsonParseException {
        JsonObject obj = json.getAsJsonObject();
        String type = obj.get("type").getAsString();
        
        return switch (type) {
            case "Call" -> {
                java.util.List<Value> args = new java.util.ArrayList<>();
                JsonElement rawArgs = obj.get("args");
                if (rawArgs != null && rawArgs.isJsonArray()) {
                    for (JsonElement arg : rawArgs.getAsJsonArray()) {
                        args.add(context.deserialize(arg, Value.class));
                    }
                } else if (obj.has("arg")) {
                    // Backwards compatibility with the single-argument wire format.
                    args.add(context.deserialize(obj.get("arg"), Value.class));
                }
                yield new Trace.Call(args);
            }
            case "QueryMember" -> new Trace.QueryMember(
                context.deserialize(obj.get("id"), Value.ObjectId.class),
                obj.get("key").getAsString()
            );
            case "Member" -> new Trace.Member(
                context.deserialize(obj.get("id"), Value.ObjectId.class),
                obj.get("key").getAsString(),
                context.deserialize(obj.get("value"), Value.class)
            );
            case "Return" -> new Trace.Return(
                obj.get("typeName").getAsString(), 
                obj.get("value").getAsString()
            );
            case "Crash" -> new Trace.Crash(obj.get("message").getAsString());
            default -> throw new JsonParseException("Unknown TraceEntry type: " + type);
        };
    }
}
