package de.hpi.swa.cli.logger;

import de.hpi.swa.analysis.Group;
import de.hpi.swa.generator.Run;

public interface ResultLogger {
    void logRun(Run result);

    void logAnalysis(String queryName, Group root);
}
