package de.hpi.swa.generator;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.time.Duration;
import java.util.Random;

import org.graalvm.polyglot.Context;
import org.junit.Test;

import de.hpi.swa.coverage.Coverage;
import de.hpi.swa.generator.Runner.FunctionResult;

public class RunnerTimeoutTest {

    @Test
    public void timedOutExecutionIsReturnedAsCrash() {
        try (Context context = Context.newBuilder("js").allowAllAccess(true).build()) {
            org.graalvm.polyglot.Value function = context.eval("js", "(x) => { while (true) {} }");

            Run run = Runner.run(function, trace(new Value.Int(1)), new Random(0), new Coverage(), context,
                    Duration.ofMillis(25));

            assertTrue(run.didCrash());
            assertTrue(((FunctionResult.Crash) run.getOutput()).message().startsWith("TimeoutError:"));
            assertTrue(run.getTrace().entries.get(run.getTrace().entries.size() - 1) instanceof Trace.Crash);
        }
    }

    @Test
    public void contextCanRunAgainAfterTimeout() {
        try (Context context = Context.newBuilder("js").allowAllAccess(true).build()) {
            org.graalvm.polyglot.Value looping = context.eval("js", "(x) => { while (true) {} }");
            Runner.run(looping, trace(new Value.Int(1)), new Random(0), new Coverage(), context,
                    Duration.ofMillis(25));

            org.graalvm.polyglot.Value normal = context.eval("js", "(x) => x + 1");
            Run run = Runner.run(normal, trace(new Value.Int(1)), new Random(0), new Coverage(), context,
                    Duration.ofMillis(250));

            assertEquals(new FunctionResult.Normal("number", "2"), run.getOutput());
        }
    }

    private static Trace trace(Value input) {
        Trace trace = new Trace();
        trace.add(new Trace.Call(java.util.List.of(input)));
        return trace;
    }
}
