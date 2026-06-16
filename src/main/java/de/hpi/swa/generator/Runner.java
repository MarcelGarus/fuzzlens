package de.hpi.swa.generator;

import java.util.Random;

import org.graalvm.polyglot.PolyglotException;
import org.graalvm.polyglot.proxy.ProxyObject;

import de.hpi.swa.coverage.Coverage;

import de.hpi.swa.generator.Trace.Call;
import de.hpi.swa.generator.Trace.Crash;
import de.hpi.swa.generator.Trace.Return;
import de.hpi.swa.generator.Trace.Member;
import de.hpi.swa.generator.Trace.QueryMember;

public abstract class Runner {

    public static Trace runWithRandomArgs(org.graalvm.polyglot.Value function, Random random) {
        var universe = new Universe();
        var input = universe.generateValue(random);
        var trace = new Trace();
        run(function, universe, input, trace, random);
        return trace;
    }

    public static Run run(org.graalvm.polyglot.Value function, Trace startingWith, Random random) {
        return run(function, startingWith, random, new Coverage());
    }

    public static Run run(org.graalvm.polyglot.Value function, Trace startingWith, Random random, Coverage coverage) {
        var universe = startingWith.toUniverse();
        var input = ((Call) startingWith.entries.get(0)).arg();
        var trace = new Trace();
        var output = run(function, universe, input, trace, random);
        return new Run(universe, input, output, trace, coverage);
    }

    public sealed interface FunctionResult {
        record Normal(String typeName, String value) implements FunctionResult {
        }

        record Crash(String message, java.util.List<String> stackTrace) implements FunctionResult {
        }

        /** Display label used for grouping: the concrete type name, or "Crash". */
        default String label() {
            return switch (this) {
                case Normal n -> n.typeName();
                case Crash c -> "Crash";
            };
        }
    }

    private static FunctionResult run(org.graalvm.polyglot.Value function, Universe universe, Value input, Trace trace, Random random) {
        trace.add(new Call(input));
        try {
            var polyglotInput = toPolyglotValue(input, universe, trace, random);
            var returnValue = function.execute(polyglotInput);

            var typeName = getTypeName(returnValue);
            String stringValue = returnValue.toString();

            trace.add(new Return(typeName, stringValue));
            return new FunctionResult.Normal(typeName, stringValue);
        } catch (PolyglotException e) {
            trace.add(new Crash(e.getMessage()));
            // map in java over e.getStackTrace() to arraylist of strings
            var stackTrace = java.util.Arrays.stream(e.getStackTrace())
                    .map(StackTraceElement::toString)
                    .toList();
            return new FunctionResult.Crash(e.getMessage(), stackTrace);
        }
    }

    private static String getTypeName(org.graalvm.polyglot.Value polyglotValue) {
        try {
            org.graalvm.polyglot.Value metaObject = polyglotValue.getMetaObject();
            if (metaObject != null) {
                return metaObject.getMetaQualifiedName();
            }
        } catch (Exception e) { }

        return "unknown";
    }

    public static org.graalvm.polyglot.Value toPolyglotValue(Value value, Universe universe, Trace trace, Random random) {
        return switch (value) {
            case Value.Null() ->
                org.graalvm.polyglot.Value.asValue(null);
            case Value.Boolean(var bool) ->
                org.graalvm.polyglot.Value.asValue(bool);
            case Value.Int(var int_) ->
                org.graalvm.polyglot.Value.asValue(int_);
            case Value.Double(var double_) ->
                org.graalvm.polyglot.Value.asValue(double_);
            case Value.StringValue(var string) ->
                org.graalvm.polyglot.Value.asValue(string);
            case Value.ObjectValue(var id) -> {
                var quantumObject = universe.getOrCreateObject(id);
                yield org.graalvm.polyglot.Value.asValue(new ProxyObject() {
                    @Override
                    public boolean hasMember(String key) {
                        if (key.equals("org.graalvm.python.embedding.KeywordArguments.is_keyword_arguments")
                                || key.equals("org.graalvm.python.embedding.PositionalArguments.is_positional_arguments")) {
                            return false;
                        }
                        trace.add(new QueryMember(id, key));
                        if (quantumObject.members.containsKey(key)) {
                            var member = quantumObject.members.get(key);
                            trace.add(new Member(id, key, member));
                            return member != null;
                        }
                        var hasMember = random.nextBoolean();
                        var value = hasMember ? universe.generateValue(random) : null;
                        quantumObject.members.put(key, value);
                        trace.add(new Member(id, key, value));
                        return hasMember;
                    }

                    @Override
                    public Object getMember(String key) {
                        return toPolyglotValue(quantumObject.members.get(key), universe, trace, random);
                    }

                    @Override
                    public void putMember(String key, org.graalvm.polyglot.Value value) {
                        throw new IllegalAccessError("Can't set members.");
                    }

                    @Override
                    public Object getMemberKeys() {
                        throw new IllegalAccessError("Can't get all member keys.");
                    }

                    @Override
                    public String toString() {
                        return id.toString();
                    }
                });
            }
        };
    }
}
