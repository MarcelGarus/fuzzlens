package de.hpi.swa.generator;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Random;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;

import org.graalvm.polyglot.Context;
import org.graalvm.polyglot.PolyglotException;
import org.graalvm.polyglot.proxy.ProxyObject;

import de.hpi.swa.coverage.Coverage;

import de.hpi.swa.generator.Trace.Call;
import de.hpi.swa.generator.Trace.Crash;
import de.hpi.swa.generator.Trace.Return;
import de.hpi.swa.generator.Trace.Member;
import de.hpi.swa.generator.Trace.QueryMember;

public abstract class Runner {

    private static final Duration INTERRUPT_GRACE = Duration.ofMillis(100);

    private static final ScheduledExecutorService TIMEOUTS = Executors.newSingleThreadScheduledExecutor(
            new ThreadFactory() {
                @Override
                public Thread newThread(Runnable runnable) {
                    Thread thread = new Thread(runnable, "graalfuzz-timeouts");
                    thread.setDaemon(true);
                    return thread;
                }
            });

    public static Trace runWithRandomArgs(org.graalvm.polyglot.Value function, Random random) {
        var universe = new Universe();
        var args = randomArgs(universe, arity(function), random);
        var trace = new Trace();
        run(function, universe, args, trace, random, null, null);
        return trace;
    }

    /** Generate {@code arity} independent random argument values. */
    public static List<Value> randomArgs(Universe universe, int arity, Random random) {
        var args = new ArrayList<Value>(arity);
        for (var i = 0; i < arity; i++) {
            args.add(universe.generateValue(random));
        }
        return args;
    }

    /**
     * Best-effort number of positional parameters the function declares, so the
     * fuzzer feeds it the right number of arguments. Python functions expose it via
     * {@code __code__.co_argcount}, JS functions via {@code length}. Falls back to a
     * single argument when arity can't be determined.
     */
    public static int arity(org.graalvm.polyglot.Value function) {
        try {
            if (function.hasMember("__code__")) {
                var code = function.getMember("__code__");
                if (code != null && code.hasMember("co_argcount")) {
                    var count = code.getMember("co_argcount");
                    if (count.fitsInInt() && count.asInt() >= 0) {
                        return count.asInt();
                    }
                }
            }
            if (function.hasMember("length")) {
                var length = function.getMember("length");
                if (length.fitsInInt() && length.asInt() >= 0) {
                    return length.asInt();
                }
            }
        } catch (RuntimeException e) {
            // Introspection isn't supported for this language/value; fall back below.
        }
        return 1;
    }

    public static Run run(org.graalvm.polyglot.Value function, Trace startingWith, Random random) {
        return run(function, startingWith, random, new Coverage());
    }

    public static Run run(org.graalvm.polyglot.Value function, Trace startingWith, Random random, Coverage coverage) {
        return run(function, startingWith, random, coverage, null, null);
    }

    public static Run run(org.graalvm.polyglot.Value function, Trace startingWith, Random random, Coverage coverage,
            Context context, Duration timeout) {
        var universe = startingWith.toUniverse();
        var args = ((Call) startingWith.entries.get(0)).args();
        var trace = new Trace();
        var output = run(function, universe, args, trace, random, context, timeout);
        return new Run(universe, args, output, trace, coverage);
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

    private static FunctionResult run(org.graalvm.polyglot.Value function, Universe universe, List<Value> args,
            Trace trace, Random random, Context context, Duration timeout) {
        trace.add(new Call(args));
        var timeoutState = new TimeoutState(timeout);
        try {
            var polyglotArgs = new Object[args.size()];
            for (var i = 0; i < args.size(); i++) {
                polyglotArgs[i] = toPolyglotValue(args.get(i), universe, trace, random);
            }
            var returnValue = execute(function, polyglotArgs, context, timeoutState);
            if (timeoutState.timedOut.get()) {
                return crash(trace, timeoutState.message(), null);
            }

            var typeName = getTypeName(returnValue);
            String stringValue = returnValue.toString();

            trace.add(new Return(typeName, stringValue));
            return new FunctionResult.Normal(typeName, stringValue);
        } catch (PolyglotException e) {
            boolean interrupted = timeoutState.timedOut.get() || e.isInterrupted();
            return crash(trace, interrupted ? timeoutState.message() : e.getMessage(), e);
        }
    }

    private static org.graalvm.polyglot.Value execute(org.graalvm.polyglot.Value function,
            Object[] args, Context context, TimeoutState timeoutState) {
        ScheduledFuture<?> timeoutTask = null;
        AtomicBoolean active = new AtomicBoolean(true);
        if (context != null && timeoutState.enabled()) {
            long timeoutMillis = Math.max(1, timeoutState.timeout.toMillis());
            timeoutTask = TIMEOUTS.schedule(() -> {
                if (!active.compareAndSet(true, false)) {
                    return;
                }
                timeoutState.timedOut.set(true);
                try {
                    context.interrupt(INTERRUPT_GRACE);
                } catch (TimeoutException | IllegalStateException e) {
                    // If the language cannot be interrupted within the grace
                    // period, the executing thread may still surface the timeout
                    // once it reaches a safepoint. The flag keeps classification
                    // stable either way.
                }
            }, timeoutMillis, TimeUnit.MILLISECONDS);
        }
        try {
            return function.execute(args);
        } finally {
            active.set(false);
            if (timeoutTask != null) {
                timeoutTask.cancel(false);
            }
        }
    }

    private static FunctionResult crash(Trace trace, String message, PolyglotException exception) {
        String safeMessage = message != null ? message : "Unknown error";
        trace.add(new Crash(safeMessage));
        var stackTrace = exception == null ? java.util.List.<String>of()
                : Arrays.stream(exception.getStackTrace())
                        .map(StackTraceElement::toString)
                        .toList();
        return new FunctionResult.Crash(safeMessage, stackTrace);
    }

    private static final class TimeoutState {
        private final Duration timeout;
        private final AtomicBoolean timedOut = new AtomicBoolean(false);

        TimeoutState(Duration timeout) {
            this.timeout = timeout;
        }

        boolean enabled() {
            return timeout != null && !timeout.isZero() && !timeout.isNegative();
        }

        String message() {
            if (!enabled()) {
                return "TimeoutError: execution interrupted";
            }
            return "TimeoutError: execution exceeded " + timeout.toMillis() + "ms";
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
