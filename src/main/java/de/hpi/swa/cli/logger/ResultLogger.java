package de.hpi.swa.cli.logger;

import de.hpi.swa.analysis.Group;

public interface ResultLogger {
    void logAnalysis(String queryName, Group root);

    /** Report how many runs have been produced so far (for a live progress indicator). */
    void logProgress(int count);
}
