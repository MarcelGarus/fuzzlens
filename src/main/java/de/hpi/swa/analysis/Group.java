package de.hpi.swa.analysis;

import java.util.List;
import java.util.Map;

import de.hpi.swa.generator.Run;

/**
 * A node in an analysis result tree: a display label, a few named aggregations
 * (counts and pre-formatted display strings), optional child groups, and
 * optional example runs. Everything the UI needs is already a string or a
 * number — the extension renders it directly, no interpretation required.
 */
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
