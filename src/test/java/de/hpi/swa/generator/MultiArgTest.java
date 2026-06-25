package de.hpi.swa.generator;

import static org.junit.Assert.assertEquals;

import java.util.List;
import java.util.Random;

import org.graalvm.polyglot.Context;
import org.junit.Test;

import de.hpi.swa.coverage.Coverage;
import de.hpi.swa.coverage.CoverageInstrument;
import de.hpi.swa.generator.Runner.FunctionResult;

public class MultiArgTest {

    @Test
    public void detectsArityOfJsFunctions() {
        try (Context context = Context.newBuilder("js").allowAllAccess(true).build()) {
            assertEquals(1, Runner.arity(context.eval("js", "(a) => a")));
            assertEquals(2, Runner.arity(context.eval("js", "(a, b) => a + b")));
            assertEquals(3, Runner.arity(context.eval("js", "(a, b, c) => a + b + c")));
        }
    }

    @Test
    public void detectsArityOfPythonFunctions() {
        try (Context context = Context.newBuilder("python").allowAllAccess(true).build()) {
            context.eval("python", "def add(a, b):\n    return a + b\n");
            assertEquals(2, Runner.arity(context.getBindings("python").getMember("add")));
        }
    }

    @Test
    public void invokesFunctionWithMultipleArguments() {
        try (Context context = Context.newBuilder("js").allowAllAccess(true).build()) {
            org.graalvm.polyglot.Value function = context.eval("js", "(a, b) => a + b");
            Trace trace = new Trace();
            trace.add(new Trace.Call(List.of(new Value.Int(2), new Value.Int(3))));

            Run run = Runner.run(function, trace, new Random(0), new Coverage(), context, null);

            assertEquals(new FunctionResult.Normal("number", "5"), run.getOutput());
            assertEquals(List.of(new Value.Int(2), new Value.Int(3)), run.getArgs());
        }
    }

    @Test
    public void formatsMultipleArgumentsAsTuple() {
        Universe universe = new Universe();
        List<Value> args = List.of(new Value.Int(2), new Value.StringValue("x"));
        assertEquals("(2, \"x\")", Value.formatArgs(args, universe));
        assertEquals("(int, string)", de.hpi.swa.analysis.Shape.ofArgs(args, universe).typeName());
    }

    @Test
    public void minimizesEachArgumentIndependently() {
        try (Context context = Context.newBuilder("js").allowAllAccess(true).build()) {
            // Crashes only while the first arg exceeds 10; the second is irrelevant.
            org.graalvm.polyglot.Value function = context.eval("js",
                    "(a, b) => { if (a > 10) { throw new Error('boom'); } return a + b; }");
            Trace trace = new Trace();
            trace.add(new Trace.Call(List.of(new Value.Int(42), new Value.Int(99))));
            Run run = Runner.run(function, trace, new Random(0), new Coverage(), context, null);

            Run minimized = new Minimizer(function, new CoverageInstrument(), context, null)
                    .minimize(run, Run::didCrash);

            // First arg shrinks to the boundary (11), second arg shrinks to 0.
            assertEquals(List.of(new Value.Int(11), new Value.Int(0)), minimized.getArgs());
        }
    }
}
