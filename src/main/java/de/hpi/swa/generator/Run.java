package de.hpi.swa.generator;

import java.util.List;

import de.hpi.swa.coverage.Coverage;
import de.hpi.swa.generator.Runner.FunctionResult;

// A single execution of the fuzzed function: the generated arguments (with their
// universe), the outcome, the trace of decisions that produced it, and the coverage
// it achieved. Self-contained — everything the analysis needs is reachable from here.
public record Run(Universe universe, List<Value> args, FunctionResult output, Trace trace, Coverage coverage) {

    public Universe getUniverse() {
        return universe;
    }

    public List<Value> getArgs() {
        return args;
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
        return new Run(universe, args, output, trace.deduplicate(), coverage);
    }
}
