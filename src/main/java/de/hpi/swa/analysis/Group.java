package de.hpi.swa.analysis;

import java.util.List;
import java.util.Map;

import de.hpi.swa.generator.Run;

// A node in an analysis result tree: a label, named aggregations (counts and
// pre-formatted display strings), child groups, and example runs. Every field is
// already a string or number, so the UI renders it without interpretation.
public record Group(String key, Map<String, Object> aggregations, List<Group> children, List<Run> samples) {

    public static Group root(List<Group> children) {
        return new Group("All", Map.of(), children, List.of());
    }

    public static Group rootWith(Map<String, Object> aggregations) {
        return new Group("All", aggregations, List.of(), List.of());
    }

    public static Group rootSamples(List<Run> samples) {
        return new Group("All", Map.of(), List.of(), samples);
    }

    public static Group leaf(String key, Map<String, Object> aggregations, List<Run> samples) {
        return new Group(key, aggregations, List.of(), samples);
    }

    public static Group branch(String key, Map<String, Object> aggregations, List<Group> children) {
        return new Group(key, aggregations, children, List.of());
    }
}
