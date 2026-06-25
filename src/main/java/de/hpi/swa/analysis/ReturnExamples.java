package de.hpi.swa.analysis;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Pattern;

import com.oracle.truffle.api.source.SourceSection;

import de.hpi.swa.generator.Run;
import de.hpi.swa.generator.Value;

/**
 * Curates one representative example per {@code return} statement in the fuzzed
 * source: the simplest non-crashing input whose coverage reached that line. This
 * is the inline "input → output" shown next to each return — selection that used
 * to run in the editor, now done where the source and per-run coverage both live.
 *
 * <p>The result is a {@link Group} (root → one leaf per return line) so it travels
 * over the same analysis channel as the other snapshots. Each leaf carries the
 * 1-based source line in its {@code Line} aggregation and the chosen run as its
 * single sample.
 */
public final class ReturnExamples {

    /** Query name this curation is exposed under, alongside the {@link Analysis} queries. */
    public static final String QUERY = "returnExamples";

    private static final Pattern RETURN_LINE = Pattern.compile("^\\s*return\\b");

    private ReturnExamples() {
    }

    /**
     * Hook for shrinking the example chosen for a given return line before it is
     * shown. Given the selected run and its 1-based source line, it returns a
     * minimized run reaching the same line (see {@code de.hpi.swa.generator.Minimizer}).
     */
    @FunctionalInterface
    public interface ExampleMinimizer {
        Run minimize(Run run, int line);
    }

    public static Group curate(String source, List<Run> runs) {
        return curate(source, runs, null);
    }

    public static Group curate(String source, List<Run> runs, ExampleMinimizer minimizer) {
        // 1-based source lines that are `return` statements.
        Set<Integer> returnLines = new HashSet<>();
        String[] lines = source.split("\n", -1);
        for (int i = 0; i < lines.length; i++) {
            if (RETURN_LINE.matcher(lines[i]).find()) {
                returnLines.add(i + 1);
            }
        }
        if (returnLines.isEmpty()) {
            return Group.root(List.of());
        }

        // Simplest non-crashing run reaching each return line (TreeMap keeps lines ordered).
        TreeMap<Integer, Run> best = new TreeMap<>();
        for (Run run : runs) {
            if (run.didCrash()) {
                continue;
            }
            for (int line : coveredUserLines(run)) {
                if (!returnLines.contains(line)) {
                    continue;
                }
                Run existing = best.get(line);
                if (existing == null || inputLength(run) < inputLength(existing)) {
                    best.put(line, run);
                }
            }
        }

        List<Group> children = best.entrySet().stream().map(entry -> {
            int line = entry.getKey();
            Run chosen = entry.getValue();
            if (minimizer != null) {
                Run reduced = minimizer.minimize(chosen, line);
                if (reduced != null) {
                    chosen = reduced;
                }
            }
            Map<String, Object> aggregations = new LinkedHashMap<>();
            aggregations.put("Line", line);
            return Group.leaf(String.valueOf(line), aggregations, List.of(chosen));
        }).toList();
        return Group.root(children);
    }

    /** The (1-based) user-code lines a run executed — internal/library sources excluded. */
    public static Set<Integer> coveredUserLines(Run run) {
        Set<Integer> lines = new HashSet<>();
        if (run.getCoverage() == null) {
            return lines;
        }
        for (SourceSection section : run.getCoverage().getCovered()) {
            if (section.getSource() != null && !section.getSource().isInternal()) {
                lines.add(section.getStartLine());
            }
        }
        return lines;
    }

    private static int inputLength(Run run) {
        return Value.formatArgs(run.getArgs(), run.getUniverse()).length();
    }
}
