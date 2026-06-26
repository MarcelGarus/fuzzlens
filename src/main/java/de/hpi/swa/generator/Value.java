package de.hpi.swa.generator;

public sealed interface Value {

    public class ObjectId {

        public final int value;

        public ObjectId(int value) {
            this.value = value;
        }

        @Override
        public String toString() {
            return "$" + value;
        }

        @Override
        public boolean equals(Object obj) {
            if (this == obj)
                return true;
            if (!(obj instanceof ObjectId other))
                return false;
            return this.value == other.value;
        }

        @Override
        public int hashCode() {
            return Integer.hashCode(value);
        }
    }

    record Null() implements Value {

        @Override
        public String toString() {
            return "null";
        }
    }

    record Boolean(boolean value) implements Value {

        @Override
        public String toString() {
            return String.valueOf(value);
        }
    }

    record Int(int value) implements Value {

        @Override
        public String toString() {
            return String.valueOf(value);
        }
    }

    record Double(double value) implements Value {

        @Override
        public String toString() {
            return String.valueOf(value);
        }
    }

    record StringValue(String value) implements Value {

        @Override
        public String toString() {
            return "\"" + value + "\"";
        }
    }

    record ObjectValue(ObjectId id) implements Value {

        @Override
        public String toString() {
            return id.toString();
        }
    }

    static Value fromObject(Object obj) {
        if (obj == null) {
            return new Value.Null();
        }
        if (obj instanceof java.lang.Boolean b) {
            return new Value.Boolean(b);
        }
        if (obj instanceof Integer i) {
            return new Value.Int(i);
        }
        if (obj instanceof java.lang.Double d) {
            return new Value.Double(d);
        }
        if (obj instanceof String s) {
            return new Value.StringValue(s);
        }
        throw new IllegalArgumentException("Unsupported object type: " + obj.getClass());
    }

    public static String format(Value value, Universe universe) {
        var builder = new StringBuilder();
        format(value, universe, 0, builder);
        return builder.toString();
    }

    // Renders a single argument bare; zero or several as a parenthesized tuple.
    public static String formatArgs(java.util.List<Value> args, Universe universe) {
        if (args.size() == 1) {
            return format(args.get(0), universe);
        }
        var builder = new StringBuilder("(");
        for (var i = 0; i < args.size(); i++) {
            if (i > 0) {
                builder.append(", ");
            }
            format(args.get(i), universe, 0, builder);
        }
        builder.append(")");
        return builder.toString();
    }

    static void format(Value value, Universe universe, int depth, StringBuilder builder) {
        if (depth > 5) {
            builder.append("...");
            return;
        }
        switch (value) {
            case Value.Null() ->
                builder.append("null");
            case Value.Boolean(var bool) ->
                builder.append(bool);
            case Value.Int(var int_) ->
                builder.append(int_);
            case Value.Double(var double_) ->
                builder.append(double_);
            case Value.StringValue(var string) -> {
                builder.append("\"");
                builder.append(string);
                builder.append("\"");
            }
            case Value.ObjectValue(var id) -> {
                builder.append("{");
                var quantumObject = universe.getOrCreateObject(id);
                for (var member : quantumObject.members.entrySet()) {
                    if (member.getValue() == null) {
                        continue;
                    }
                    builder.append(member.getKey());
                    builder.append(": ");
                    format((Value) member.getValue(), universe, depth + 1, builder);
                }
                builder.append("}");
            }
        }
    }
}
