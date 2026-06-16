package de.hpi.swa.analysis;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import de.hpi.swa.generator.Universe;
import de.hpi.swa.generator.Value;
import de.hpi.swa.generator.Value.ObjectId;

public sealed interface Shape {

    record Null() implements Shape {
        @Override
        public String toString() {
            return "null";
        }
    }

    record Boolean() implements Shape {
        @Override
        public String toString() {
            return "boolean";
        }
    }

    record Int() implements Shape {
        @Override
        public String toString() {
            return "int";
        }
    }

    record Double() implements Shape {
        @Override
        public String toString() {
            return "double";
        }
    }

    record StringShape() implements Shape {
        @Override
        public String toString() {
            return "string";
        }
    }

    record ObjectShape(ObjectId id, Universe universe) implements Shape {
        public ObjectShape {
            if (universe.get(id) == null) {
                throw new IllegalArgumentException("ObjectId " + id + " does not exist in the universe");
            }
        }

        public Set<String> keys() {
            var obj = universe.get(id);
            return obj.members.entrySet().stream()
                    .filter(entry -> entry.getValue() != null)
                    .map(entry -> entry.getKey())
                    .collect(Collectors.toSet());
        }

        public Shape at(String key) {
            var obj = universe.get(id);
            var value = obj.members.get(key);
            if (value == null) {
                return null;
            } else {
                return Shape.fromValue(value, universe);
            }
        }

        @Override
        public String toString() {
            var obj = universe.get(id);
            List<String> memberShapes = obj.members.entrySet().stream()
                    .filter(e -> e.getValue() != null)
                    .map(e -> e.getKey() + ": " + at(e.getKey()).toString())
                    .sorted()
                    .toList();
            return "{" + String.join(", ", memberShapes) + "}";
        }

        @Override
        public boolean equals(Object obj) {
            if (this == obj)
                return true;
            if (!(obj instanceof ObjectShape other))
                return false;

            // Compare only the id and the structure of the object, not the universe
            // reference
            if (!this.id.equals(other.id))
                return false;

            var thisObj = this.universe.get(this.id);
            var otherObj = other.universe.get(other.id);

            if (thisObj == null && otherObj == null)
                return true;
            if (thisObj == null || otherObj == null)
                return false;

            if (!thisObj.members.keySet().equals(otherObj.members.keySet()))
                return false;

            for (String key : thisObj.members.keySet()) {
                Shape thisShape = at(key);
                Shape otherShape = other.at(key);
                if (thisShape == null && otherShape == null)
                    continue;
                if (thisShape == null || otherShape == null)
                    return false;
                if (!thisShape.equals(otherShape))
                    return false;
            }

            return true;
        }

        @Override
        public int hashCode() {
            var obj = universe.get(id);
            if (obj == null)
                return id.hashCode();

            int result = id.hashCode();
            for (String key : obj.members.keySet()) {
                Shape shape = at(key);
                result = 31 * result + (shape != null ? shape.hashCode() : 0);
            }
            return result;
        }
    }

    public default String typeName() {
        return switch (this) {
            case ObjectShape o -> "object";
            case Null n -> "null";
            case Boolean b -> "boolean";
            case Int i -> "int";
            case Double d -> "double";
            case StringShape s -> "string";
        };
    }

    public static Shape fromValue(Value value, Universe universe) {
        return switch (value) {
            case Value.Null v ->
                new Shape.Null();
            case Value.Boolean v ->
                new Shape.Boolean();
            case Value.Int v ->
                new Shape.Int();
            case Value.Double v ->
                new Shape.Double();
            case Value.StringValue v ->
                new Shape.StringShape();
            case Value.ObjectValue objVal ->
                new Shape.ObjectShape(objVal.id(), universe);
        };
    }
}
