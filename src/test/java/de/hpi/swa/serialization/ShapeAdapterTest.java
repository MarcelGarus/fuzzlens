package de.hpi.swa.serialization;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import de.hpi.swa.analysis.Shape;
import de.hpi.swa.generator.Universe;
import de.hpi.swa.generator.Value;

import org.junit.Test;
import static org.junit.Assert.*;

public class ShapeAdapterTest {

    private final Gson gson = GsonConfig.createGson();

    @Test
    public void testSerializeNullShape() {
        Shape shape = new Shape.Null();
        String json = gson.toJson(shape, Shape.class);
        JsonObject obj = JsonParser.parseString(json).getAsJsonObject();
        
        assertEquals("Null", obj.get("type").getAsString());
    }

    @Test
    public void testSerializeBooleanShape() {
        Shape shape = new Shape.Boolean();
        String json = gson.toJson(shape, Shape.class);
        JsonObject obj = JsonParser.parseString(json).getAsJsonObject();
        
        assertEquals("Boolean", obj.get("type").getAsString());
    }

    @Test
    public void testSerializeIntShape() {
        Shape shape = new Shape.Int();
        String json = gson.toJson(shape, Shape.class);
        JsonObject obj = JsonParser.parseString(json).getAsJsonObject();
        
        assertEquals("Int", obj.get("type").getAsString());
    }

    @Test
    public void testSerializeDoubleShape() {
        Shape shape = new Shape.Double();
        String json = gson.toJson(shape, Shape.class);
        JsonObject obj = JsonParser.parseString(json).getAsJsonObject();
        
        assertEquals("Double", obj.get("type").getAsString());
    }

    @Test
    public void testSerializeStringShape() {
        Shape shape = new Shape.StringShape();
        String json = gson.toJson(shape, Shape.class);
        JsonObject obj = JsonParser.parseString(json).getAsJsonObject();
        
        assertEquals("String", obj.get("type").getAsString());
    }

    @Test
    public void testSerializeObjectShape() {
        Universe universe = new Universe();
        Value.ObjectId objId = universe.createObject();
        
        // Add some members to the object
        universe.get(objId).members.put("name", new Value.StringValue("test"));
        universe.get(objId).members.put("age", new Value.Int(42));
        
        Shape shape = new Shape.ObjectShape(objId, universe);
        String json = gson.toJson(shape, Shape.class);
        JsonObject obj = JsonParser.parseString(json).getAsJsonObject();
        
        assertEquals("Object", obj.get("type").getAsString());
        assertTrue(obj.has("members"));
        
        JsonObject members = obj.getAsJsonObject("members");
        assertTrue(members.has("name"));
        assertTrue(members.has("age"));
        
        assertEquals("String", members.getAsJsonObject("name").get("type").getAsString());
        assertEquals("Int", members.getAsJsonObject("age").get("type").getAsString());
    }

    @Test
    public void testSerializeNestedObjectShape() {
        Universe universe = new Universe();
        Value.ObjectId outerObjId = universe.createObject();
        Value.ObjectId innerObjId = universe.createObject();
        
        // Create nested structure: {outer: {inner: "value"}}
        universe.get(innerObjId).members.put("inner", new Value.StringValue("value"));
        universe.get(outerObjId).members.put("outer", new Value.ObjectValue(innerObjId));
        
        Shape shape = new Shape.ObjectShape(outerObjId, universe);
        String json = gson.toJson(shape, Shape.class);
        JsonObject obj = JsonParser.parseString(json).getAsJsonObject();
        
        assertEquals("Object", obj.get("type").getAsString());
        
        JsonObject members = obj.getAsJsonObject("members");
        assertTrue(members.has("outer"));
        
        JsonObject outerMember = members.getAsJsonObject("outer");
        assertEquals("Object", outerMember.get("type").getAsString());
        
        JsonObject innerMembers = outerMember.getAsJsonObject("members");
        assertTrue(innerMembers.has("inner"));
        assertEquals("String", innerMembers.getAsJsonObject("inner").get("type").getAsString());
    }

    @Test
    public void testSerializeEmptyObjectShape() {
        Universe universe = new Universe();
        Value.ObjectId objId = universe.createObject();
        
        Shape shape = new Shape.ObjectShape(objId, universe);
        String json = gson.toJson(shape, Shape.class);
        JsonObject obj = JsonParser.parseString(json).getAsJsonObject();
        
        assertEquals("Object", obj.get("type").getAsString());
        assertTrue(obj.has("members"));
        assertTrue(obj.getAsJsonObject("members").entrySet().isEmpty());
    }

    @Test
    public void testDeserializePrimitiveShapes() {
        String nullJson = "{\"type\":\"Null\"}";
        Shape nullShape = gson.fromJson(nullJson, Shape.class);
        assertTrue(nullShape instanceof Shape.Null);

        String boolJson = "{\"type\":\"Boolean\"}";
        Shape boolShape = gson.fromJson(boolJson, Shape.class);
        assertTrue(boolShape instanceof Shape.Boolean);

        String intJson = "{\"type\":\"Int\"}";
        Shape intShape = gson.fromJson(intJson, Shape.class);
        assertTrue(intShape instanceof Shape.Int);

        String doubleJson = "{\"type\":\"Double\"}";
        Shape doubleShape = gson.fromJson(doubleJson, Shape.class);
        assertTrue(doubleShape instanceof Shape.Double);

        String stringJson = "{\"type\":\"String\"}";
        Shape stringShape = gson.fromJson(stringJson, Shape.class);
        assertTrue(stringShape instanceof Shape.StringShape);
    }

    @Test
    public void testRoundTripPrimitiveShapes() {
        Shape[] shapes = {
            new Shape.Null(),
            new Shape.Boolean(),
            new Shape.Int(),
            new Shape.Double(),
            new Shape.StringShape()
        };

        for (Shape original : shapes) {
            String json = gson.toJson(original, Shape.class);
            Shape deserialized = gson.fromJson(json, Shape.class);
            assertEquals(original, deserialized);
        }
    }
}
