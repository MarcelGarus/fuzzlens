package de.hpi.swa.generator;

/**
 * A cheap, structural measure of how "complex" a generated input is: higher for
 * larger-magnitude numbers, longer strings, more object fields, fractional
 * doubles, and (only as a tie-breaker) less-canonical characters.
 *
 * <p>Folded into the fuzzer's pool score beside coverage (see {@link Pool}), it
 * favours, among inputs that reach the same code, the simpler one — toward zero,
 * shorter, fewer fields. That gives the fuzzer a built-in pressure toward small
 * inputs, replacing what used to be a separate minimization pass.
 *
 * <p>Magnitudes are on a {@code log1p} scale so that, say, {@code 5} and
 * {@code 5000} differ but neither swamps a coverage difference.
 */
public final class Complexity {

    /** Per-character weight: small, so string length dominates but ties break toward "smaller" letters. */
    private static final double CHAR_WEIGHT = 0.001;

    /** Base cost of an object value; its fields are counted via the trace's Member entries. */
    private static final double OBJECT_BASE = 1.0;

    private Complexity() {
    }

    /**
     * Total complexity of the input a trace describes: the call arguments plus one
     * contribution per present object field. Observations (queries, returns,
     * crashes) carry no input and are ignored.
     */
    public static double of(Trace trace) {
        double total = 0.0;
        for (Trace.TraceEntry entry : trace.entries) {
            switch (entry) {
                case Trace.Call(var args) -> {
                    for (Value arg : args) {
                        total += of(arg);
                    }
                }
                case Trace.Member(var id, var key, var value) -> {
                    if (value != null) {
                        total += of(value);
                    }
                }
                default -> {
                }
            }
        }
        return total;
    }

    /** Complexity of a single value (an object's fields are accounted for at the trace level). */
    public static double of(Value value) {
        return switch (value) {
            case Value.Null() -> 0.0;
            case Value.Boolean(var b) -> b ? 1.0 : 0.0;
            case Value.Int(var n) -> Math.log1p(Math.abs((double) n));
            case Value.Double(var d) -> ofDouble(d);
            case Value.StringValue(var s) -> ofString(s);
            case Value.ObjectValue(var id) -> OBJECT_BASE;
        };
    }

    private static double ofDouble(double d) {
        if (Double.isNaN(d) || Double.isInfinite(d)) {
            return 10.0; // non-finite values are treated as quite complex
        }
        double magnitude = Math.log1p(Math.abs(d));
        double fractionalPenalty = (d == Math.floor(d)) ? 0.0 : 1.0; // whole numbers are simpler
        return magnitude + fractionalPenalty;
    }

    private static double ofString(String s) {
        double total = s.length(); // length dominates
        for (int i = 0; i < s.length(); i++) {
            total += charComplexity(s.charAt(i)) * CHAR_WEIGHT;
        }
        return total;
    }

    /** A small per-character cost with {@code 'a'} the simplest letter; only ever breaks ties. */
    private static double charComplexity(char c) {
        if (c >= 'a' && c <= 'z') {
            return c - 'a';
        }
        if (c >= 'A' && c <= 'Z') {
            return 26 + (c - 'A');
        }
        if (c >= '0' && c <= '9') {
            return c - '0';
        }
        return 52; // symbols, whitespace, etc.
    }
}
