package de.hpi.swa.generator;

import static org.junit.Assert.assertTrue;

import java.util.HashSet;
import java.util.List;
import java.util.Random;
import java.util.Set;

import org.graalvm.polyglot.Context;
import org.junit.Test;

import de.hpi.swa.coverage.Coverage;
import de.hpi.swa.generator.Runner.FunctionResult;

public class StringGenerationTest {

    @Test
    public void generatesVariedLengthsAndCharacterClasses() {
        Universe universe = new Universe();
        Random random = new Random(0);

        boolean sawDigit = false;
        boolean sawLetter = false;
        boolean sawShort = false; // length < 6
        boolean sawEmpty = false;
        for (int i = 0; i < 500; i++) {
            String s = universe.generateString(random);
            sawDigit |= s.chars().anyMatch(Character::isDigit);
            sawLetter |= s.chars().anyMatch(Character::isLetter);
            sawShort |= s.length() < 6;
            sawEmpty |= s.isEmpty();
        }

        assertTrue("expected some strings to contain a digit", sawDigit);
        assertTrue("expected some strings to contain a letter", sawLetter);
        assertTrue("expected some strings shorter than 6 chars", sawShort);
        assertTrue("expected the empty string to be generated", sawEmpty);
    }

    @Test
    public void fuzzingReachesEveryBranchOfValidatePassword() {
        String code = """
                def validate_password(password):
                    if len(password) < 6:
                        return False
                    if not any(c.isdigit() for c in password):
                        return False
                    if not any(c.isalpha() for c in password):
                        return False
                    return True
                """;
        try (Context context = Context.newBuilder("python").allowAllAccess(true).build()) {
            context.eval("python", code);
            org.graalvm.polyglot.Value function = context.getBindings("python").getMember("validate_password");

            Universe universe = new Universe();
            Random random = new Random(0);
            Set<String> outcomes = new HashSet<>();
            for (int i = 0; i < 1000; i++) {
                Trace trace = new Trace();
                trace.add(new Trace.Call(List.of(new Value.StringValue(universe.generateString(random)))));
                Run run = Runner.run(function, trace, random, new Coverage());
                if (run.getOutput() instanceof FunctionResult.Normal normal) {
                    outcomes.add(normal.value());
                }
            }

            // A letters-and-digits password of length >= 6 hits `return True`; the
            // old single-class generator could never produce one.
            boolean reachedTrue = outcomes.stream().anyMatch(v -> v.equalsIgnoreCase("true"));
            boolean reachedFalse = outcomes.stream().anyMatch(v -> v.equalsIgnoreCase("false"));
            assertTrue("expected at least one valid password reaching `return True`", reachedTrue);
            assertTrue("expected at least one rejected password reaching `return False`", reachedFalse);
        }
    }
}
