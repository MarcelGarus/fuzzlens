package de.hpi.swa.coverage;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import com.oracle.truffle.api.source.Source;
import com.oracle.truffle.api.source.SourceSection;

// Expression-based coverage of source-code, really just a set of
// `SourceSection`s with convenient helper methods.
public final class Coverage {

    private final Set<SourceSection> covered = new HashSet<SourceSection>();

    public void addCovered(SourceSection section) {
        covered.add(section);
    }

    public Set<SourceSection> getCovered() {
        return covered;
    }

    public static Coverage union(Coverage... coverages) {
        Coverage result = new Coverage();
        for (Coverage coverage : coverages) {
            result.covered.addAll(coverage.covered);
        }
        return result;
    }

    public void printFull() {
        var allSources = new HashSet<Source>();
        for (var section : covered) {
            allSources.add(section.getSource());
        }

        var coveredLines = linesByFile(covered);

        for (var source : allSources) {
            var path = source.getPath();
            if (path == null) {
                continue;
            }
            System.err.println(path);
            var coveredLinesOfSource = coveredLines
                .getOrDefault(source, new HashSet<Integer>());
            for (int i = 1; i <= source.getLineCount(); i++) {
                var c = coveredLinesOfSource.contains(i) ? '+' : ' ';
                System.err.println(String.format("%s %s", c, source.getCharacters(i)));
            }
        }
    }

    public static Map<Source, Set<Integer>> linesByFile(Set<SourceSection> sections) {
        var out = new HashMap<Source, Set<Integer>>();
        for (var section : sections) {
            var source = section.getSource();
            out.putIfAbsent(source, new HashSet<Integer>());
            var lines = out.get(source);
            for (int i = section.getStartLine(); i <= section.getEndLine(); i++) {
                lines.add(i);
            }
        }
        return out;
    }

    @Override
    public String toString() {
        return "Coverage{" + covered.size() + " sections covered}";
    }

    public String toString(Coverage reference) {
        var sb = new StringBuilder();
        for (var section : reference.covered) {
            sb.append(covered.contains(section) ? 'X' : '_');
        }
        return sb.toString();
    }

    @Override
    public boolean equals(Object obj) {
        if (this == obj) {
            return true;
        }
        if (obj == null || getClass() != obj.getClass()) {
            return false;
        }
        Coverage coverage = (Coverage) obj;
        return covered.equals(coverage.covered);
    }

    @Override
    public int hashCode() {
        return covered.hashCode();
    }
}
