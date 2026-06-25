package de.hpi.swa.serialization;

import com.google.gson.*;

import de.hpi.swa.analysis.Shape;

import java.lang.reflect.Type;

public class ShapeAdapter implements JsonSerializer<Shape>, JsonDeserializer<Shape> {

    @Override
    public JsonElement serialize(Shape shape, Type typeOfSrc, JsonSerializationContext context) {
        JsonObject result = new JsonObject();

        switch (shape) {
            case Shape.Null() -> {
                result.addProperty("type", "Null");
            }
            case Shape.Boolean() -> {
                result.addProperty("type", "Boolean");
            }
            case Shape.Int() -> {
                result.addProperty("type", "Int");
            }
            case Shape.Double() -> {
                result.addProperty("type", "Double");
            }
            case Shape.StringShape() -> {
                result.addProperty("type", "String");
            }
            case Shape.ObjectShape obj -> {
                result.addProperty("type", "Object");
                JsonObject members = new JsonObject();
                for (String key : obj.keys()) {
                    Shape memberShape = obj.at(key);
                    if (memberShape != null) {
                        members.add(key, context.serialize(memberShape, Shape.class));
                    }
                }
                result.add("members", members);
            }
            case Shape.Tuple tuple -> {
                result.addProperty("type", "Tuple");
                JsonArray elements = new JsonArray();
                for (Shape element : tuple.elements()) {
                    elements.add(context.serialize(element, Shape.class));
                }
                result.add("elements", elements);
            }
        }

        return result;
    }

    @Override
    public Shape deserialize(JsonElement json, Type typeOfT, JsonDeserializationContext context)
            throws JsonParseException {
        JsonObject obj = json.getAsJsonObject();
        String type = obj.get("type").getAsString();

        return switch (type) {
            case "Null" -> new Shape.Null();
            case "Boolean" -> new Shape.Boolean();
            case "Int" -> new Shape.Int();
            case "Double" -> new Shape.Double();
            case "String" -> new Shape.StringShape();
            case "Object" -> {
                // Deserializing ObjectShape is complex since we need to reconstruct the
                // Universe
                // For now, we don't support deserializing ObjectShapes (only serializing them)
                throw new JsonParseException("Deserializing ObjectShape is not yet supported");
            }
            case "Tuple" -> {
                java.util.List<Shape> elements = new java.util.ArrayList<>();
                for (JsonElement element : obj.getAsJsonArray("elements")) {
                    elements.add(context.deserialize(element, Shape.class));
                }
                yield new Shape.Tuple(elements);
            }
            default -> throw new JsonParseException("Unknown Shape type: " + type);
        };
    }
}
