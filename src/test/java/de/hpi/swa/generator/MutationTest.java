package de.hpi.swa.generator;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.Random;

import org.junit.Test;

public class MutationTest {

    @Test
    public void mutationIsTypePreservingAndBooleansFlip() {
        Universe universe = new Universe();
        Random random = new Random(0);
        for (int i = 0; i < 200; i++) {
            assertEquals(new Value.Boolean(false), universe.mutateValue(new Value.Boolean(true), random));
            assertTrue(universe.mutateValue(new Value.Int(7), random) instanceof Value.Int);
            assertTrue(universe.mutateValue(new Value.Double(7.5), random) instanceof Value.Double);
            assertTrue(universe.mutateValue(new Value.StringValue("hello"), random) instanceof Value.StringValue);
        }
    }

    @Test
    public void characterMutationCanIntroduceADigit() {
        Universe universe = new Universe();
        Random random = new Random(0);
        boolean introducedDigit = false;
        for (int i = 0; i < 2000 && !introducedDigit; i++) {
            // Always mutate the same letters-only string, so any digit must have
            // been introduced by a single-character edit (not carried over).
            Value mutated = universe.mutateValue(new Value.StringValue("abcdefgh"), random);
            String s = ((Value.StringValue) mutated).value();
            introducedDigit = s.chars().anyMatch(Character::isDigit);
        }
        assertTrue("character-level mutation should be able to introduce a digit", introducedDigit);
    }

    @Test
    public void rethinkValueExercisesBothFreshAndMutatePaths() {
        Universe universe = new Universe();
        Random random = new Random(0);

        // generateValue only ever produces ints in [0, 100); a value far outside
        // that range can only come from mutating the existing one.
        Value existing = new Value.Int(1_000_000);
        boolean sawMutation = false; // an Int well outside the fresh range
        boolean sawFresh = false;    // a non-Int can only come from fresh generation
        for (int i = 0; i < 1000; i++) {
            Value result = universe.rethinkValue(existing, random);
            if (result instanceof Value.Int(var n) && Math.abs(n) >= 100) {
                sawMutation = true;
            }
            if (!(result instanceof Value.Int)) {
                sawFresh = true;
            }
        }
        assertTrue("expected some results to be mutations of the existing value", sawMutation);
        assertTrue("expected some results to be freshly generated values", sawFresh);
    }
}
