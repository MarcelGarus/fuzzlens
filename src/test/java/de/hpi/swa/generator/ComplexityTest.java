package de.hpi.swa.generator;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.List;

import org.junit.Test;

import de.hpi.swa.coverage.Coverage;

public class ComplexityTest {

    @Test
    public void primitivesRankByMagnitudeAndShape() {
        assertEquals(0.0, Complexity.of(new Value.Null()), 0.0);
        assertEquals(0.0, Complexity.of(new Value.Boolean(false)), 0.0);

        assertTrue(Complexity.of(new Value.Boolean(false)) < Complexity.of(new Value.Boolean(true)));

        // Integers: nearer zero is simpler; sign doesn't matter.
        assertTrue(Complexity.of(new Value.Int(0)) < Complexity.of(new Value.Int(5)));
        assertTrue(Complexity.of(new Value.Int(5)) < Complexity.of(new Value.Int(5000)));
        assertEquals(Complexity.of(new Value.Int(-5)), Complexity.of(new Value.Int(5)), 0.0);

        // Doubles: whole numbers are simpler than fractional ones.
        assertTrue(Complexity.of(new Value.Double(3.0)) < Complexity.of(new Value.Double(3.5)));
    }

    @Test
    public void stringsRankByLengthThenByCharacter() {
        assertTrue(Complexity.of(new Value.StringValue("")) < Complexity.of(new Value.StringValue("a")));
        assertTrue(Complexity.of(new Value.StringValue("a")) < Complexity.of(new Value.StringValue("aa")));
        // Same length: "smaller" letters win the tie-break, but length always dominates.
        assertTrue(Complexity.of(new Value.StringValue("a")) < Complexity.of(new Value.StringValue("z")));
        assertTrue(Complexity.of(new Value.StringValue("zzz")) < Complexity.of(new Value.StringValue("aaaa")));
    }

    @Test
    public void traceSumsArgumentsAndObjectFields() {
        Value.ObjectId id = new Value.ObjectId(0);

        Trace oneField = new Trace();
        oneField.add(new Trace.Call(List.of(new Value.ObjectValue(id))));
        oneField.add(new Trace.Member(id, "a", new Value.Int(1)));

        Trace twoFields = new Trace();
        twoFields.add(new Trace.Call(List.of(new Value.ObjectValue(id))));
        twoFields.add(new Trace.Member(id, "a", new Value.Int(1)));
        twoFields.add(new Trace.Member(id, "b", new Value.Int(1)));

        // An absent field (null value) adds nothing.
        Trace absentField = new Trace();
        absentField.add(new Trace.Call(List.of(new Value.ObjectValue(id))));
        absentField.add(new Trace.Member(id, "a", new Value.Int(1)));
        absentField.add(new Trace.Member(id, "b", null));

        assertTrue(Complexity.of(oneField) < Complexity.of(twoFields));
        assertEquals(Complexity.of(oneField), Complexity.of(absentField), 0.0);
    }

    @Test
    public void poolPrefersSimplerInputAtEqualCoverage() {
        // Same (empty) coverage, so quality differs only by input complexity.
        Pool.PoolEntry simple = new Pool.PoolEntry(callTrace(new Value.Int(5)), new Coverage());
        Pool.PoolEntry complex = new Pool.PoolEntry(callTrace(new Value.Int(5000)), new Coverage());
        Pool.PoolEntry longString = new Pool.PoolEntry(
                callTrace(new Value.StringValue("abcdefghijkl")), new Coverage());

        assertTrue("smaller int should outrank larger int", simple.quality > complex.quality);
        assertTrue("short input should outrank long string", simple.quality > longString.quality);
    }

    private static Trace callTrace(Value arg) {
        Trace trace = new Trace();
        trace.add(new Trace.Call(List.of(arg)));
        return trace;
    }
}
