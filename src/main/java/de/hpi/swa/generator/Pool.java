package de.hpi.swa.generator;

import java.util.HashMap;
import java.util.Map;
import java.util.Random;

import de.hpi.swa.coverage.Coverage;
import de.hpi.swa.generator.Trace.Call;

public class Pool {

    public static class PoolEntry {

        public final Trace trace;
        public final Coverage coverage;
        public final double quality;

        public PoolEntry(Trace trace, Coverage coverage) {
            this.trace = trace;
            this.coverage = coverage;
            this.quality = Math.pow(2, coverage.getCovered().size() * 10.0 + trace.entries.size());
        }
    }

    private final Map<Trace, PoolEntry> entries;
    private final Random random;

    public Pool() {
        this.entries = new HashMap<>();
        this.random = new Random();
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
            trace.add(new Call((new Universe()).generateValue(random)));
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
