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

    /**
     * Characters strings are drawn from. Spanning lowercase, uppercase, digits and
     * a few symbols lets generated strings exercise type/content branches a single
     * character class can't reach — e.g. {@code any(c.isdigit())} or a
     * letters-only check — instead of pinning every run to one branch.
     */
    private static final String STRING_ALPHABET =
            "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _-.!@#";

    /** Upper bound on generated string length; lengths range over {@code [0, MAX]}. */
    private static final int MAX_STRING_LENGTH = 12;

    String generateString(Random random) {
        // Variable length (including the empty string) so length-sensitive branches
        // such as `len(s) < 6` are reachable without relying on minimization.
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

    /**
     * When mutating a trace decision, either roll a completely fresh value or tweak
     * the existing one. Fresh generation keeps exploring; tweaking keeps the fuzzer
     * near inputs that already reached interesting code, so a near-miss can be
     * nudged over a branch (a length-6 word gaining a digit, an int crossing a
     * threshold) by a single small edit rather than a lucky from-scratch roll.
     */
    public Value rethinkValue(Value existing, Random random) {
        if (existing == null || random.nextBoolean()) {
            return generateValue(random);
        }
        return mutateValue(existing, random);
    }

    /** A small, type-preserving tweak of {@code value} (see {@link #rethinkValue}). */
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
            case 0 -> // replace a character (can introduce a new character class)
                sb.setCharAt(random.nextInt(sb.length()), randomChar(random));
            case 1 -> // insert a character
                sb.insert(random.nextInt(sb.length() + 1), randomChar(random));
            case 2 -> // delete a character
                sb.deleteCharAt(random.nextInt(sb.length()));
            default -> { // shift one character's code point by one (e.g. across a boundary)
                var i = random.nextInt(sb.length());
                sb.setCharAt(i, (char) (sb.charAt(i) + (random.nextBoolean() ? 1 : -1)));
            }
        }
        return sb.toString();
    }
}
