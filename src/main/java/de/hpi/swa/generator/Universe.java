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

    // Spanning lowercase, uppercase, digits and symbols lets strings exercise
    // content branches a single character class can't reach, e.g. `any(c.isdigit())`
    // or a letters-only check.
    private static final String STRING_ALPHABET =
            "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _-.!@#";

    private static final int MAX_STRING_LENGTH = 12;

    String generateString(Random random) {
        // Variable length (including empty) so length-sensitive branches such as
        // `len(s) < 6` are reachable.
        var length = random.nextInt(MAX_STRING_LENGTH + 1);
        var sb = new StringBuilder(length);
        for (var i = 0; i < length; i++) {
            sb.append(randomChar(random));
        }
        return sb.toString();
    }

    private char randomChar(Random random) {
        return STRING_ALPHABET.charAt(random.nextInt(STRING_ALPHABET.length()));
    }

    // Either roll a fresh value or tweak the existing one. Fresh generation keeps
    // exploring; tweaking stays near inputs that already reached interesting code, so
    // a near-miss can be nudged over a branch (a length-6 word gaining a digit, an int
    // crossing a threshold) by one small edit rather than a lucky from-scratch roll.
    public Value rethinkValue(Value existing, Random random) {
        if (existing == null || random.nextBoolean()) {
            return generateValue(random);
        }
        return mutateValue(existing, random);
    }

    // A small, type-preserving tweak of `value`.
    public Value mutateValue(Value value, Random random) {
        return switch (value) {
            // Null and objects have nothing to tweak in place; explore instead.
            case Value.Null() -> generateValue(random);
            case Value.ObjectValue(var id) -> generateValue(random);
            case Value.Boolean(var b) -> new Value.Boolean(!b);
            case Value.Int(var n) -> new Value.Int(mutateInt(n, random));
            case Value.Double(var d) -> new Value.Double(mutateDouble(d, random));
            case Value.StringValue(var s) -> new Value.StringValue(mutateString(s, random));
        };
    }

    private int mutateInt(int n, Random random) {
        return switch (random.nextInt(6)) {
            case 0 -> n + 1;
            case 1 -> n - 1;
            case 2 -> n + random.nextInt(21) - 10; // small jump in [-10, 10]
            case 3 -> n * 2;
            case 4 -> n / 2;
            default -> -n;
        };
    }

    private double mutateDouble(double d, Random random) {
        return switch (random.nextInt(6)) {
            case 0 -> d + 1;
            case 1 -> d - 1;
            case 2 -> d * 2;
            case 3 -> d / 2;
            case 4 -> -d;
            default -> d + (random.nextDouble() - 0.5); // small fractional nudge
        };
    }

    private String mutateString(String s, Random random) {
        if (s.isEmpty()) {
            // Nothing to edit in place; grow it by one character.
            return String.valueOf(randomChar(random));
        }
        var sb = new StringBuilder(s);
        switch (random.nextInt(4)) {
            case 0 -> // replace (can introduce a new character class)
                sb.setCharAt(random.nextInt(sb.length()), randomChar(random));
            case 1 ->
                sb.insert(random.nextInt(sb.length() + 1), randomChar(random));
            case 2 ->
                sb.deleteCharAt(random.nextInt(sb.length()));
            default -> { // shift a code point by one, e.g. across a class boundary
                var i = random.nextInt(sb.length());
                sb.setCharAt(i, (char) (sb.charAt(i) + (random.nextBoolean() ? 1 : -1)));
            }
        }
        return sb.toString();
    }
}
