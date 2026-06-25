package de.hpi.swa.analysis;

import static org.junit.Assert.assertEquals;

import java.util.List;

import org.junit.Test;

import de.hpi.swa.coverage.Coverage;
import de.hpi.swa.generator.Run;
import de.hpi.swa.generator.Runner.FunctionResult;
import de.hpi.swa.generator.Trace;
import de.hpi.swa.generator.Universe;
import de.hpi.swa.generator.Value;

public class SignatureShapeTest {

    private static Value point(Universe universe, double x, double y) {
        Value.ObjectId id = universe.createObject();
        Universe.Object object = universe.getOrCreateObject(id);
        object.members.put("x", new Value.Double(x));
        object.members.put("y", new Value.Double(y));
        return new Value.ObjectValue(id);
    }

    @Test
    public void signatureKeepsEachArgumentsObjectStructure() {
        Universe universe = new Universe();
        List<Value> args = List.of(point(universe, 1.0, 2.0), point(universe, 3.0, 4.0));
        Run run = new Run(universe, args, new FunctionResult.Normal("float", "2.83"), new Trace(), new Coverage());

        Group signature = Analysis.observedSignature(List.of(run));

        assertEquals("({x: double, y: double}, {x: double, y: double})",
                signature.aggregations().get("Input"));
        assertEquals("float", signature.aggregations().get("Output"));
    }

    @Test
    public void singleObjectArgumentIsStillRenderedBare() {
        Universe universe = new Universe();
        Run run = new Run(universe, List.of(point(universe, 1.0, 2.0)),
                new FunctionResult.Normal("float", "1.0"), new Trace(), new Coverage());

        Group signature = Analysis.observedSignature(List.of(run));

        assertEquals("{x: double, y: double}", signature.aggregations().get("Input"));
    }
}
