package de.hpi.swa.generator;

import de.hpi.swa.coverage.Coverage;
import de.hpi.swa.generator.Runner.FunctionResult;

/**
 * A single execution of the fuzzed function: the generated input (with its
 * universe), the outcome, the trace of decisions that produced it, and the code
 * coverage it achieved. A {@code Run} is self-contained — everything the
 * analysis needs is reachable from here, no external lookup required.
 */
public record Run(Universe universe, Value input, FunctionResult output, Trace trace, Coverage coverage) {

    public Universe getUniverse() {
        return universe;
    }

    public Value getInput() {
        return input;
    }

    public FunctionResult getOutput() {
        return output;
    }

    public Trace getTrace() {
        return trace;
    }

    public Coverage getCoverage() {
        return coverage;
    }

    public boolean didCrash() {
        return output instanceof FunctionResult.Crash;
    }

    public boolean isValid() {
        return !didCrash();
    }

    public Run withDeduplicatedTrace() {
        return new Run(universe, input, output, trace.deduplicate(), coverage);
    }
}
