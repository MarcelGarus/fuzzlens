package de.hpi.swa.analysis;

import static java.util.stream.Collectors.groupingBy;
import static java.util.stream.Collectors.toCollection;
import static java.util.stream.Collectors.toList;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;

import de.hpi.swa.coverage.Coverage;
import de.hpi.swa.generator.Run;
import de.hpi.swa.generator.Runner.FunctionResult;
import de.hpi.swa.generator.Value;

/**
 * The whole analysis layer: a handful of pure functions over {@code List<Run>}.
 * Each named query groups, counts, and picks examples, then returns a
 * {@link Group} tree whose labels and aggregations are already display-ready.
 */
public final class Analysis {

    private Analysis() {
    }

    /**
     * Optional final-pass hook that shrinks displayed example runs while preserving
     * the analysis-specific fact the example represents.
     */
    @FunctionalInterface
    public interface SampleMinimizer {
        Run minimize(Run run, java.util.function.Predicate<Run> invariant);
    }

    /**
     * Errors that indicate the input itself was invalid (wrong shape) rather than
     * a genuinely interesting behaviour. Excluded when looking for "valid" runs.
     */
    static final Set<String> INVALID_INPUT_ERRORS = Set.of(
            "AttributeError", "TypeError", "KeyError", "Uncaught TypeError");

    public static List<String> available() {
        return List.of("observedSignature", "inputShapeOutputTypeTable", "exceptionExamples",
                "validExamples", "treeList", "relevantPairs");
    }

    public static Group run(String name, List<Run> rows) {
        return run(name, rows, null);
    }

    public static Group run(String name, List<Run> rows, SampleMinimizer minimizer) {
        return switch (name) {
            case "observedSignature" -> observedSignature(rows);
            case "inputShapeOutputTypeTable" -> inputShapeOutputTypeTable(rows);
            case "exceptionExamples" -> exceptionExamples(rows, minimizer);
            case "validExamples" -> validExamples(rows, minimizer);
            case "treeList" -> treeList(rows, minimizer);
            case "relevantPairs" -> relevantPairs(rows, minimizer);
            default -> null;
        };
    }

    // === Derived facts (plain functions over a Run) ===

    static String outputType(Run r) {
        return r.getOutput().label();
    }

    static String exceptionType(Run r) {
        if (r.getOutput() instanceof FunctionResult.Crash c) {
            return c.message() != null ? c.message().split(":")[0] : "UnknownException";
        }
        return null;
    }

    static boolean isInvalidInput(Run r) {
        var ex = exceptionType(r);
        return ex != null && INVALID_INPUT_ERRORS.contains(ex);
    }

    static boolean isValidOrInteresting(Run r) {
        return !isInvalidInput(r);
    }

    static boolean isInterestingCrash(Run r) {
        return r.didCrash() && !isInvalidInput(r);
    }

    static Shape inputShape(Run r) {
        return Shape.fromValue(r.getInput(), r.getUniverse());
    }

    static String inputKind(Run r) {
        return inputShape(r).typeName();
    }

    static String inputValue(Run r) {
        return Value.format(r.getInput(), r.getUniverse());
    }

    // === Shared helpers ===

    /** Keep one run per distinct (formatted) input value. */
    static List<Run> dedupe(List<Run> rows) {
        var seen = new HashSet<String>();
        return rows.stream().filter(r -> seen.add(inputValue(r))).toList();
    }

    /** Up to n example runs, smallest input first. */
    static List<Run> examples(Collection<Run> rows, int n) {
        return rows.stream()
                .sorted(Comparator.comparingInt(r -> inputValue(r).length()))
                .limit(n)
                .toList();
    }

    static List<Run> examples(Collection<Run> rows, int n, SampleMinimizer minimizer,
            java.util.function.Predicate<Run> invariant) {
        List<Run> picked = examples(rows, n);
        if (minimizer == null) {
            return picked;
        }
        return picked.stream()
                .map(run -> {
                    Run reduced = minimizer.minimize(run, invariant);
                    return reduced != null ? reduced : run;
                })
                .toList();
    }

    static int crashes(Collection<Run> rows) {
        return (int) rows.stream().filter(Run::didCrash).count();
    }

    private static final Comparator<Group> BY_COUNT_DESC = Comparator
            .comparingInt((Group g) -> g.aggregations().get("Count") instanceof Integer i ? i : 0)
            .reversed();

    /** Conventional ordering for primitive type names in a union. */
    static int typeRank(String t) {
        return switch (t.toLowerCase()) {
            case "null", "nonetype" -> 0;
            case "boolean", "bool" -> 1;
            case "int" -> 2;
            case "double", "float" -> 3;
            case "string", "str" -> 4;
            case "crash" -> 999;
            default -> 100;
        };
    }

    static String unionOf(Collection<String> types) {
        return String.join(" | ", types.stream().distinct()
                .sorted(Comparator.comparingInt(Analysis::typeRank).thenComparing(t -> t))
                .toList());
    }

    /**
     * Merge a collection of shapes into a single display string, recursively
     * unioning object members. Empty objects are rendered as {@code {}} (so a
     * member that is sometimes a string and sometimes an empty object shows up as
     * {@code string | {}} rather than silently dropping the {@code {}}).
     */
    static String shapeUnion(Collection<Shape> shapes) {
        var primitives = new ArrayList<String>();
        var objects = new ArrayList<Shape.ObjectShape>();
        for (Shape s : shapes) {
            if (s instanceof Shape.ObjectShape o) {
                objects.add(o);
            } else {
                primitives.add(s.typeName());
            }
        }
        var parts = new ArrayList<String>(primitives.stream().distinct()
                .sorted(Comparator.comparingInt(Analysis::typeRank).thenComparing(t -> t))
                .toList());
        if (!objects.isEmpty()) {
            parts.add(objectUnion(objects));
        }
        return parts.isEmpty() ? "any" : String.join(" | ", parts);
    }

    private static String objectUnion(List<Shape.ObjectShape> objects) {
        var keys = new TreeSet<String>();
        for (var o : objects) {
            keys.addAll(o.keys());
        }
        if (keys.isEmpty()) {
            return "{}";
        }
        var parts = new ArrayList<String>();
        for (var key : keys) {
            var shapesAtKey = new ArrayList<Shape>();
            for (var o : objects) {
                var s = o.at(key);
                if (s != null) {
                    shapesAtKey.add(s);
                }
            }
            parts.add(key + ": " + shapeUnion(shapesAtKey));
        }
        return "{" + String.join(", ", parts) + "}";
    }

    // === Queries ===

    /** Root-level summary: the union of all valid input shapes and output types. */
    static Group observedSignature(List<Run> rows) {
        var valid = dedupe(rows).stream().filter(Analysis::isValidOrInteresting).toList();
        var aggregations = new LinkedHashMap<String, Object>();
        aggregations.put("Input", valid.isEmpty() ? "any"
                : shapeUnion(valid.stream().map(Analysis::inputShape).toList()));
        aggregations.put("Output", valid.isEmpty() ? "unknown"
                : unionOf(valid.stream().map(Analysis::outputType).toList()));
        return Group.rootWith(aggregations);
    }

    /**
     * Group input shapes that produce the same set of output types together.
     * Each child is one output-type set, labelled by that set, carrying the union
     * of input shapes that map to it and the total run count.
     */
    static Group inputShapeOutputTypeTable(List<Run> rows) {
        record ShapeFacts(Shape shape, Set<String> outputs, int count) {
        }

        var perShape = dedupe(rows).stream()
                .filter(Analysis::isValidOrInteresting)
                .collect(groupingBy(Analysis::inputShape, LinkedHashMap::new, toList()))
                .entrySet().stream()
                .map(e -> new ShapeFacts(
                        e.getKey(),
                        e.getValue().stream().map(Analysis::outputType).collect(toCollection(LinkedHashSet::new)),
                        e.getValue().size()))
                .toList();

        var children = perShape.stream()
                .collect(groupingBy(ShapeFacts::outputs, LinkedHashMap::new, toList()))
                .entrySet().stream()
                .map(e -> {
                    String outputs = unionOf(e.getKey());
                    String input = shapeUnion(e.getValue().stream().map(ShapeFacts::shape).toList());
                    int total = e.getValue().stream().mapToInt(ShapeFacts::count).sum();
                    var aggregations = new LinkedHashMap<String, Object>();
                    aggregations.put("Input", input);
                    aggregations.put("Count", total);
                    return Group.leaf(outputs, aggregations, List.of());
                })
                .sorted(BY_COUNT_DESC)
                .toList();

        return Group.root(children);
    }

    /** One minimal example per (exception type, input shape), most frequent first. */
    static Group exceptionExamples(List<Run> rows, SampleMinimizer minimizer) {
        record Key(String exception, Shape shape) {
        }

        var children = dedupe(rows).stream()
                .filter(Analysis::isInterestingCrash)
                .collect(groupingBy(r -> new Key(exceptionType(r), inputShape(r)), LinkedHashMap::new, toList()))
                .entrySet().stream()
                .map(e -> {
                    var aggregations = new LinkedHashMap<String, Object>();
                    aggregations.put("Count", e.getValue().size());
                    aggregations.put("Exception", e.getKey().exception());
                    String label = e.getKey().exception() + " (" + e.getKey().shape() + ")";
                    var key = e.getKey();
                    return Group.leaf(label, aggregations, examples(e.getValue(), 1, minimizer,
                            r -> isInterestingCrash(r)
                                    && key.exception().equals(exceptionType(r))
                                    && key.shape().equals(inputShape(r))));
                })
                .sorted(BY_COUNT_DESC)
                .toList();

        return Group.root(children);
    }

    /** One example per (input type, covered path) among non-crashing runs. */
    static Group validExamples(List<Run> rows, SampleMinimizer minimizer) {
        record Key(String type, Coverage path) {
        }

        var picked = dedupe(rows).stream()
                .filter(Run::isValid)
                .collect(groupingBy(r -> new Key(inputKind(r), r.getCoverage()), LinkedHashMap::new, toList()))
                .values().stream()
                .map(group -> {
                    Run chosen = examples(group, 1).get(0);
                    if (minimizer == null) {
                        return chosen;
                    }
                    Key key = new Key(inputKind(chosen), chosen.getCoverage());
                    Run reduced = minimizer.minimize(chosen,
                            r -> r.isValid() && key.type().equals(inputKind(r))
                                    && Objects.equals(key.path(), r.getCoverage()));
                    return reduced != null ? reduced : chosen;
                })
                .toList();

        return Group.rootSamples(examples(picked, 20));
    }

    /** Input shape → output type, nested, with counts and examples. */
    static Group treeList(List<Run> rows, SampleMinimizer minimizer) {
        var children = dedupe(rows).stream()
                .filter(Analysis::isValidOrInteresting)
                .collect(groupingBy(r -> inputShape(r).toString(), LinkedHashMap::new, toList()))
                .entrySet().stream()
                .map(e -> {
                    var outputs = e.getValue().stream()
                            .collect(groupingBy(Analysis::outputType, LinkedHashMap::new, toList()))
                            .entrySet().stream()
                            .map(o -> {
                                var aggregations = new LinkedHashMap<String, Object>();
                                aggregations.put("Count", o.getValue().size());
                                aggregations.put("CrashCount", crashes(o.getValue()));
                                String shape = e.getKey();
                                String output = o.getKey();
                                return Group.leaf(output, aggregations, examples(o.getValue(), 10, minimizer,
                                        r -> isValidOrInteresting(r)
                                                && shape.equals(inputShape(r).toString())
                                                && output.equals(outputType(r))));
                            })
                            .sorted(BY_COUNT_DESC)
                            .toList();
                    var aggregations = new LinkedHashMap<String, Object>();
                    aggregations.put("Count", e.getValue().size());
                    aggregations.put("CrashCount", crashes(e.getValue()));
                    return Group.branch(e.getKey(), aggregations, outputs);
                })
                .sorted(BY_COUNT_DESC)
                .toList();

        return Group.root(children);
    }

    /** Input shape → output type pairs with a few examples each, for inline display. */
    static Group relevantPairs(List<Run> rows, SampleMinimizer minimizer) {
        var children = dedupe(rows).stream()
                .filter(Analysis::isValidOrInteresting)
                .collect(groupingBy(r -> inputShape(r).toString() + " → " + outputType(r),
                        LinkedHashMap::new, toList()))
                .entrySet().stream()
                .map(e -> {
                    var aggregations = new LinkedHashMap<String, Object>();
                    aggregations.put("Count", e.getValue().size());
                    String key = e.getKey();
                    return Group.leaf(key, aggregations, examples(e.getValue(), 3, minimizer,
                            r -> isValidOrInteresting(r)
                                    && key.equals(inputShape(r).toString() + " → " + outputType(r))));
                })
                .sorted(BY_COUNT_DESC)
                .toList();

        return Group.root(children);
    }
}
