package de.hpi.swa.coverage;

import com.oracle.truffle.api.frame.VirtualFrame;
import com.oracle.truffle.api.instrumentation.ExecutionEventNode;
import com.oracle.truffle.api.source.SourceSection;

// A node that wraps AST nodes of interest and informs the `CoverageInstrument`
// that we covered its source section.
final class CoverageNode extends ExecutionEventNode {

    private final CoverageInstrument instrument;
    private final SourceSection section;

    CoverageNode(CoverageInstrument instrument, SourceSection section) {
        this.instrument = instrument;
        this.section = section;
    }

    @Override
    public void onEnter(VirtualFrame frame) {
        instrument.recordCovered(section);
    }

    @Override
    public void onReturnValue(VirtualFrame vFrame, Object result) {
        // Coverage tracked in onEnter is enough.
    }
}
