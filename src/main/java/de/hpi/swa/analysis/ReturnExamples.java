package de.hpi.swa.analysis;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Pattern;

import com.oracle.truffle.api.source.SourceSection;

import de.hpi.swa.generator.Complexity;
import de.hpi.swa.generator.Run;

// Picks one representative example per `return` statement in the fuzzed source:
// the simplest non-crashing input whose coverage reached that line, shown inline
// as "input → output" next to each return.
//
// The result is a `Group` (root → one leaf per return line) so it travels over
// the same analysis channel as the other snapshots. Each leaf carries the 1-based
// source line in its `Line` aggregation and the chosen run as its single sample.
public final class ReturnExamples {

    // Query name this is exposed under, alongside the `Analysis` queries.
    public static final String QUERY = "returnExamples";

    private static final Pattern RETURN_LINE = Pattern.compile("^\\s*return\\b");

    private ReturnExamples() {
    }

    public static Group curate(String source, List<Run> runs) {
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
                if (existing == null || inputComplexity(run) < inputComplexity(existing)) {
                    best.put(line, run);
                }
            }
        }

        List<Group> children = best.entrySet().stream().map(entry -> {
            int line = entry.getKey();
            Run chosen = entry.getValue();
            Map<String, Object> aggregations = new LinkedHashMap<>();
            aggregations.put("Line", line);
            return Group.leaf(String.valueOf(line), aggregations, List.of(chosen));
        }).toList();
        return Group.root(children);
    }

    // The 1-based user-code lines a run executed — internal/library sources excluded.
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

    private static double inputComplexity(Run run) {
        return Complexity.of(run.getTrace());
    }
}
