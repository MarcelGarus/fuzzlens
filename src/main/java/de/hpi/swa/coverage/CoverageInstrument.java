package de.hpi.swa.coverage;

import org.graalvm.options.OptionCategory;
import org.graalvm.options.OptionDescriptors;
import org.graalvm.options.OptionKey;
import org.graalvm.options.OptionStability;

import com.oracle.truffle.api.ContextLocal;
import com.oracle.truffle.api.Option;
import com.oracle.truffle.api.instrumentation.SourceSectionFilter;
import com.oracle.truffle.api.instrumentation.TruffleInstrument;
import com.oracle.truffle.api.instrumentation.TruffleInstrument.Registration;
import com.oracle.truffle.api.source.SourceSection;

@Registration(
    id = CoverageInstrument.ID,
    name = "Code Coverage",
    version = "0.1",
    services = CoverageInstrument.class
)
public final class CoverageInstrument extends TruffleInstrument {
    public static final String ID = "code-coverage";

    // Enable flag named after the instrument id, so `engine.option("code-coverage",
    // "true")` switches the instrument on and triggers onCreate.
    @Option(name = "", help = "Enable Coverage (default: false).", category = OptionCategory.USER, stability = OptionStability.STABLE)
    static final OptionKey<Boolean> ENABLED = new OptionKey<>(false);

    // Coverage of the current run, kept per context so several fuzzing jobs can
    // run concurrently on the shared engine while tracking different coverages.
    // The coverage is wrapped in a `RunCoverage` so that 
    private final ContextLocal<RunCoverage> runCoverage = locals.createContextLocal(ctx -> new RunCoverage());
    static final class RunCoverage {
        Coverage current = new Coverage();
    }

    void recordCovered(SourceSection section) {
        runCoverage.get().current.addCovered(section);
    }

    public Coverage startRun() {
        var fresh = new Coverage();
        runCoverage.get().current = fresh;
        return fresh;
    }

    @Override
    protected OptionDescriptors getOptionDescriptors() {
        // Generated from the @Option above by the Truffle annotation processor.
        return new CoverageInstrumentOptionDescriptors();
    }

    @Override
    protected void onCreate(Env env) {
        if (!ENABLED.getValue(env.getOptions())) {
            return;
        }
        var filter = SourceSectionFilter.newBuilder().includeInternal(true).build();
        // Wrap all AST node with a coverage tracking node.
        env.getInstrumenter().attachExecutionEventFactory(filter, (context) -> {
            var source = context.getInstrumentedSourceSection();
            if (source == null) return null;
            return new CoverageNode(this, source);
        });
        // Lets the embedder fetch this instance via lookup(CoverageInstrument.class).
        env.registerService(this);
    }
}
