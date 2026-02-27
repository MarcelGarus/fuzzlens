package de.hpi.swa.generator;

import java.util.HashMap;
import java.util.Map;
import java.util.Random;

import de.hpi.swa.generator.Value.ObjectId;

public class Universe {

    private final Map<ObjectId, Object> objects = new HashMap<>();

    public class Object {

        public final Map<String, Value> members = new HashMap<>();
    }

    public ObjectId createObject() {
        var index = objects.size();
        while (objects.containsKey(new ObjectId(index))) {
            index++;
        }
        var id = new ObjectId(index);
        objects.put(id, new Object());
        return id;
    }

    public Object getOrCreateObject(ObjectId id) {
        objects.putIfAbsent(id, new Object());
        return objects.get(id);
    }

    public Object get(ObjectId id) {
        return objects.get(id);
    }

    public Value generateValue(Random random) {
        return switch (random.nextInt(6)) {
            case 0 ->
                new Value.Null();
            case 1 ->
                new Value.Boolean(random.nextBoolean());
            case 2 ->
                new Value.Int(random.nextInt(100));
            case 3 ->
                new Value.Double(random.nextDouble(100));
            case 4 ->
                new Value.StringValue(generateString(random));
            case 5 ->
                new Value.ObjectValue(createObject());
            default ->
                throw new IllegalStateException("unreachable");
        };
    }

    private String generateString(Random random) {
        var length = 10;
        var sb = new StringBuilder(length);
        for (var i = 0; i < length; i++) {
            sb.append((char) ('a' + random.nextInt(26)));
        }
        return sb.toString();
    }
}
