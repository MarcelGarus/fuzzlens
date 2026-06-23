package de.hpi.swa.generator;

import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Random;
import java.util.Set;
import java.util.function.Predicate;

import org.graalvm.polyglot.Context;

import de.hpi.swa.coverage.Coverage;
import de.hpi.swa.coverage.CoverageInstrument;
import de.hpi.swa.generator.Trace.Call;
import de.hpi.swa.generator.Trace.Member;
import de.hpi.swa.generator.Trace.TraceEntry;

/**
 * Shrinks a {@link Run} to a smaller, more canonical input that still satisfies a
 * caller-supplied invariant — classic delta-debugging adapted to this fuzzer's
 * value model.
 *
 * <p>A run's input is fully described by the {@link Trace.TraceEntry.Decision}
 * entries of its trace: the {@link Call} argument and one {@link Member} per
 * object field. Re-running such an "input trace" through {@link Runner} is
 * deterministic for a fixed input, so we can propose a simpler value for one slot
 * at a time, re-run, and keep the change only when the invariant still holds.
 *
 * <p>Reductions follow the natural "less is simpler" ordering:
 * <ul>
 *   <li>object field → removed (represented by a Java {@code null} trace value)</li>
 *   <li>int → towards zero (0, then halved)</li>
 *   <li>double → fewer decimal places, then towards zero</li>
 *   <li>string → emptied, then halved</li>
 *   <li>boolean → {@code false}</li>
 * </ul>
 * The strongest reduction for each slot is tried first; the loop repeats until a
 * full pass commits nothing (a fixpoint), bounded by {@link #MAX_EVALUATIONS}.
 */
public final class Minimizer {

    /** Safety bound on re-runs per {@link #minimize} call, in case the invariant never settles. */
    private static final int MAX_EVALUATIONS = 2000;

    private final org.graalvm.polyglot.Value function;
    private final CoverageInstrument instrument;
    private final Context context;
    private final Duration timeout;

    private int evaluations;

    private record MemberKey(Value.ObjectId id, String key) {
    }

    public Minimizer(org.graalvm.polyglot.Value function, CoverageInstrument instrument) {
        this(function, instrument, null, null);
    }

    public Minimizer(org.graalvm.polyglot.Value function, CoverageInstrument instrument, Context context,
            Duration timeout) {
        this.function = function;
        this.instrument = instrument;
        this.context = context;
        this.timeout = timeout;
    }

    /**
     * Returns a minimized {@link Run} equivalent to {@code run} under
     * {@code invariant}, or {@code run} itself if its behaviour can't be
     * reproduced (e.g. nondeterminism) or nothing could be reduced.
     */
    public Run minimize(Run run, Predicate<Run> invariant) {
        evaluations = 0;

        Trace current = inputTrace(run.getTrace());
        Run best = rerun(current);
        if (best == null || !satisfies(invariant, best)) {
            // The property doesn't reproduce on a clean re-run; don't risk
            // showing something that no longer holds — keep the original.
            return run;
        }

        while (evaluations < MAX_EVALUATIONS) {
            boolean committed = false;
            for (int i = 0; i < current.entries.size() && evaluations < MAX_EVALUATIONS; i++) {
                Value value = slotValue(current.entries.get(i));
                if (value == null) {
                    continue;
                }
                boolean isMember = current.entries.get(i) instanceof Member;
                for (Value candidate : simplerCandidates(value, isMember)) {
                    if (evaluations >= MAX_EVALUATIONS) {
                        break;
                    }
                    Trace trial = replaceSlot(current, i, candidate);
                    Run trialRun = rerun(trial);
                    if (trialRun != null && satisfies(invariant, trialRun)) {
                        best = trialRun;
                        // Re-pin from what actually executed so newly-relevant
                        // fields become reducible and re-runs stay deterministic.
                        current = inputTrace(trialRun.getTrace());
                        committed = true;
                        break;
                    }
                }
                if (committed) {
                    break;
                }
            }
            if (!committed) {
                break;
            }
        }
        return best;
    }

    private static boolean satisfies(Predicate<Run> invariant, Run run) {
        try {
            return invariant.test(run);
        } catch (RuntimeException e) {
            return false;
        }
    }

    /**
     * The minimal trace that reproduces a run's input: the leading {@link Call}
     * followed by one {@link Member} per distinct object field (first wins). This
     * is all {@link Runner#run} reads — observations are recomputed on replay.
     */
    private static Trace inputTrace(Trace trace) {
        Trace result = new Trace();
        Set<MemberKey> seenMembers = new HashSet<>();
        for (TraceEntry entry : trace.entries) {
            switch (entry) {
                case Call call -> {
                    if (result.entries.isEmpty()) {
                        result.add(call);
                    }
                }
                case Member member -> {
                    if (seenMembers.add(new MemberKey(member.id(), member.key()))) {
                        result.add(member);
                    }
                }
                default -> {
                }
            }
        }
        return result;
    }

    private static Value slotValue(TraceEntry entry) {
        return switch (entry) {
            case Call(var arg) -> arg;
            case Member(var id, var key, var value) -> value;
            default -> null;
        };
    }

    private static Trace replaceSlot(Trace trace, int index, Value newValue) {
        Trace result = new Trace();
        for (int i = 0; i < trace.entries.size(); i++) {
            TraceEntry entry = trace.entries.get(i);
            if (i == index) {
                result.add(switch (entry) {
                    case Call ignored -> new Call(newValue);
                    case Member(var id, var key, var value) -> new Member(id, key, newValue);
                    default -> entry;
                });
            } else {
                result.add(entry);
            }
        }
        return result;
    }

    /**
     * Candidate simpler values for one slot, strongest reduction first. An object
     * field (a {@link Member}) may additionally be dropped entirely by nulling it.
     */
    private static List<Value> simplerCandidates(Value value, boolean isMember) {
        List<Value> candidates = new ArrayList<>();

        // Fewer fields: drop the whole field before bothering to shrink its value.
        // A Java null means "member absent"; Value.Null means "member exists and is
        // null", which is a different input.
        if (isMember && value != null) {
            candidates.add(null);
        }

        switch (value) {
            case Value.Int(var n) -> {
                if (n != 0) {
                    candidates.add(new Value.Int(0));
                }
                int half = n / 2;
                if (half != n && half != 0) {
                    candidates.add(new Value.Int(half));
                }
                // Linear descent: one step closer to zero, so a fixpoint lands on
                // the exact boundary that the binary jumps above only bracket.
                int step = n - Integer.signum(n);
                if (step != n && step != 0 && step != half) {
                    candidates.add(new Value.Int(step));
                }
            }
            case Value.Double(var d) -> {
                if (!Double.isNaN(d) && !Double.isInfinite(d)) {
                    // Fewer decimal places first ...
                    double truncated = (double) (long) d;
                    if (truncated != d) {
                        candidates.add(new Value.Double(truncated));
                    }
                    // ... then towards zero.
                    if (d != 0.0) {
                        candidates.add(new Value.Double(0.0));
                    }
                    double half = (double) (long) (d / 2);
                    if (half != d && half != 0.0) {
                        candidates.add(new Value.Double(half));
                    }
                    // Linear descent on the integer part, for the exact boundary.
                    if (d == truncated && Math.abs(d) >= 1.0) {
                        double step = d - Math.signum(d);
                        if (step != half) {
                            candidates.add(new Value.Double(step));
                        }
                    }
                }
            }
            case Value.StringValue(var s) -> {
                if (!s.isEmpty()) {
                    candidates.add(new Value.StringValue(""));
                    String half = s.substring(0, s.length() / 2);
                    if (!half.isEmpty() && !half.equals(s)) {
                        candidates.add(new Value.StringValue(half));
                    }
                    // Linear descent: drop one trailing char, for the exact length.
                    String shorter = s.substring(0, s.length() - 1);
                    if (!shorter.isEmpty() && !shorter.equals(half)) {
                        candidates.add(new Value.StringValue(shorter));
                    }
                }
            }
            case Value.Boolean(var b) -> {
                if (b) {
                    candidates.add(new Value.Boolean(false));
                }
            }
            default -> {
            }
        }
        return candidates;
    }

    /** Replay an input trace, returning the resulting run (or {@code null} on failure). */
    private Run rerun(Trace inputTrace) {
        evaluations++;
        try {
            instrument.coverage = new Coverage();
            // A fixed seed keeps any incidental member generation reproducible.
            return Runner.run(function, inputTrace, new Random(0), instrument.coverage, context, timeout);
        } catch (RuntimeException e) {
            return null;
        }
    }
}
