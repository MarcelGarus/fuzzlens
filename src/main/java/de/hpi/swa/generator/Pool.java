package de.hpi.swa.generator;

import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.stream.Collectors;

import de.hpi.swa.coverage.Coverage;
import de.hpi.swa.generator.Trace.Call;

public class Pool {

    /** Each covered element is worth this much in the score's exponent. */
    private static final double COVERAGE_WEIGHT = 10.0;

    /**
     * Larger values soften how sharply complexity is penalised. The penalty is
     * mapped into {@code [0, 1)}, strictly less than {@link #COVERAGE_WEIGHT}, so
     * coverage always dominates: complexity only ranks inputs that reach the same
     * code, preferring the simpler one (a built-in minimization pressure).
     */
    private static final double COMPLEXITY_SOFTENING = 25.0;

    public static class PoolEntry {

        public final Trace trace;
        public final Coverage coverage;
        public final double quality;

        public PoolEntry(Trace trace, Coverage coverage) {
            this.trace = trace;
            this.coverage = coverage;
            double coverageScore = coverage.getCovered().size() * COVERAGE_WEIGHT;
            // Map complexity into [0, 1): higher complexity → larger penalty, but
            // never enough to outweigh a single covered element.
            double complexity = Complexity.of(trace);
            double complexityPenalty = complexity / (complexity + COMPLEXITY_SOFTENING);
            this.quality = Math.pow(2, coverageScore - complexityPenalty);
        }
    }

    private final Map<Trace, PoolEntry> entries;
    private final Random random;
    private final int arity;

    public Pool(int arity) {
        this.entries = new HashMap<>();
        this.random = new Random();
        this.arity = arity;
    }

    public void add(Trace trace, Coverage coverage) {
        // Use deduplicated trace as key for consistent hashing
        Trace keyTrace = trace.deduplicate();
        PoolEntry newEntry = new PoolEntry(keyTrace, coverage);

        // Only add or replace if new entry has better quality
        PoolEntry existing = entries.get(keyTrace);
        if (existing == null || newEntry.quality > existing.quality) {
            entries.put(keyTrace, newEntry);
        }
    }

    public Trace createNewTrace() {
        if (entries.isEmpty() || random.nextDouble() < 0.01) {
            var trace = new Trace();
            trace.add(new Call(Runner.randomArgs(new Universe(), arity, random)));
            return trace;
        }

        while (true) {
            var newTrace = selectWeightedEntry().trace.rethinkLastDecisions(random);
            if (isWorthExploring(newTrace)) {
                return newTrace;
            }
        }
    }

    private PoolEntry selectWeightedEntry() {
        var poolEntries = entries.values();
        if (poolEntries.size() == 1) {
            return poolEntries.iterator().next();
        }

        double totalQuality = poolEntries.stream()
                .mapToDouble(entry -> entry.quality)
                .sum();

        if (totalQuality == 0.0) {
            int randomIndex = random.nextInt(poolEntries.size());
            return poolEntries.stream().skip(randomIndex).findFirst().orElseThrow();
        }

        double randomValue = random.nextDouble() * totalQuality;
        double cumulativeQuality = 0.0;

        for (var entry : poolEntries) {
            cumulativeQuality += entry.quality;
            if (randomValue <= cumulativeQuality) {
                return entry;
            }
        }

        // Fallback to any entry (should not happen with proper math)
        return poolEntries.iterator().next();
    }

    private boolean isWorthExploring(Trace trace) {
        for (var keyTrace : entries.keySet()) {
            if (keyTrace.startsWith(trace) && keyTrace.numDecisions() == trace.numDecisions()) {
                return false;
            }
        }
        return true;
    }

    public Coverage getCoverage(Trace trace) throws IllegalArgumentException {
        Trace keyTrace = trace.deduplicate();
        PoolEntry entry = entries.get(keyTrace);
        if (entry != null) {
            return entry.coverage;
        } else {
            throw new IllegalArgumentException("Trace not found in pool.");
        }
    }

    public int size() {
        return entries.size();
    }

    /**
     * The deduplicated, highest-quality traces this pool discovered — the curated
     * "interesting inputs" (most coverage first). Worth replaying as seeds on a
     * later run of the same function to re-confirm prior behaviour quickly.
     */
    public List<Trace> bestTraces(int limit) {
        return entries.values().stream()
                .sorted(Comparator.comparingDouble((PoolEntry entry) -> entry.quality).reversed())
                .limit(limit)
                .map(entry -> entry.trace)
                .collect(Collectors.toList());
    }

    public void printStats() {
        System.err.println("Pool stats: " + entries.size() + " entries");
        int i = 0;
        for (var entry : entries.values()) {
            System.err.println("  Entry " + i + ": coverage=" + entry.coverage.getCovered().size()
                    + ", quality=" + entry.quality + ": " + entry.trace);
            i++;
        }
    }
}
