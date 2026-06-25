package de.hpi.swa.generator;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import java.util.Random;

import org.graalvm.polyglot.Context;
import org.junit.Test;

import de.hpi.swa.coverage.Coverage;
import de.hpi.swa.coverage.CoverageInstrument;
import de.hpi.swa.generator.Runner.FunctionResult;

public class MinimizerTest {

    @Test
    public void minimizesIntegerToBoundaryThatStillSatisfiesInvariant() {
        try (Context context = Context.newBuilder("js").allowAllAccess(true).build()) {
            org.graalvm.polyglot.Value function = context.eval("js", "(x) => x > 10 ? 'big' : 'small'");
            Run run = run(function, new Value.Int(42));

            Run minimized = new Minimizer(function, new CoverageInstrument()).minimize(run,
                    candidate -> normalValue(candidate).equals("big"));

            assertEquals(java.util.List.of(new Value.Int(11)), minimized.getArgs());
            assertEquals("big", normalValue(minimized));
        }
    }

    @Test
    public void removesObjectMemberWhenInvariantDoesNotNeedIt() {
        try (Context context = Context.newBuilder("js").allowAllAccess(true).build()) {
            org.graalvm.polyglot.Value function = context.eval("js",
                    "(x) => ('a' in x ? x.a : 0) + ('noise' in x ? 0 : 0)");
            Value.ObjectId id = new Value.ObjectId(0);
            Trace trace = new Trace();
            trace.add(new Trace.Call(java.util.List.of(new Value.ObjectValue(id))));
            trace.add(new Trace.Member(id, "a", new Value.Int(9)));
            trace.add(new Trace.Member(id, "noise", new Value.Int(123)));
            Run run = Runner.run(function, trace, new Random(0), new Coverage());

            Run minimized = new Minimizer(function, new CoverageInstrument()).minimize(run,
                    candidate -> normalValue(candidate).equals("9"));

            Universe.Object object = minimized.getUniverse().get(id);
            assertEquals(new Value.Int(9), object.members.get("a"));
            assertTrue(object.members.containsKey("noise"));
            assertNull(object.members.get("noise"));
            assertEquals("{a: 9}", Value.formatArgs(minimized.getArgs(), minimized.getUniverse()));
        }
    }

    @Test
    public void returnsOriginalRunWhenInvariantDoesNotReproduce() {
        try (Context context = Context.newBuilder("js").allowAllAccess(true).build()) {
            org.graalvm.polyglot.Value function = context.eval("js", "(x) => x");
            Run run = run(function, new Value.Int(5));

            Run minimized = new Minimizer(function, new CoverageInstrument()).minimize(run, candidate -> false);

            assertSame(run, minimized);
        }
    }

    private static Run run(org.graalvm.polyglot.Value function, Value input) {
        Trace trace = new Trace();
        trace.add(new Trace.Call(java.util.List.of(input)));
        return Runner.run(function, trace, new Random(0), new Coverage());
    }

    private static String normalValue(Run run) {
        return ((FunctionResult.Normal) run.getOutput()).value();
    }
}
