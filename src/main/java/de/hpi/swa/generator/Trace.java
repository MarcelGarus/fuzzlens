package de.hpi.swa.generator;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.Random;

import de.hpi.swa.generator.Trace.TraceEntry.Decision;
import de.hpi.swa.generator.Value.ObjectId;

public class Trace {

    public sealed interface TraceEntry {

        sealed interface Decision extends TraceEntry {
        }

        sealed interface Observation extends TraceEntry {
        }
    }

    public record Call(java.util.List<Value> args) implements TraceEntry.Decision {

    }

    public record QueryMember(ObjectId id, String key) implements TraceEntry.Observation {

    }

    public record Member(ObjectId id, String key, Value value) implements TraceEntry.Decision {

    }

    public record Return(String typeName, String value) implements TraceEntry.Observation {

    }

    public record Crash(String message) implements TraceEntry.Observation {

    }

    public final ArrayList<TraceEntry> entries = new ArrayList<>();

    public void add(TraceEntry entry) {
        entries.add(entry);
    }

    @Override
    public String toString() {
        return toString(true);
    }

    @SuppressWarnings("unused")
    public String toString(boolean colored) {
        if (entries.isEmpty()) {
            return "";
        }

        var ANSI_RESET = "\u001B[0m";
        var ANSI_RED = "\u001B[31m";
        var ANSI_GREEN = "\u001B[32m";
        var ANSI_BLUE = "\u001B[34m";
        var ANSI_GREY = "\u001B[90m";

        StringBuilder sb = new StringBuilder();
        for (var entry : entries) {
            if (!sb.isEmpty()) {
                sb.append(" > ");
            }
            if (colored) {
                if (entry instanceof TraceEntry.Decision) {
                    sb.append(ANSI_GREEN);
                } else {
                    sb.append(ANSI_BLUE);
                }
            }
            switch (entry) {
                case Call(var args) ->
                    sb.append("call with ").append(args);
                case QueryMember(var object, var key) ->
                    sb.append(object).append(".").append(key);
                case Member(var object, var key, var value) -> {

                    if (value == null) {
                        sb.append("does not exist");
                    } else {
                        sb.append(value);
                    }
                }
                case Return ret ->
                    sb.append("return ").append(ret.value()).append(" (").append(ret.typeName()).append(")");
                case Crash(var message) ->
                    sb.append("crash ").append(message);
            }

            if (colored) {
                sb.append(ANSI_RESET);
            }
        }
        return sb.toString();
    }

    public boolean startsWith(Trace other) {
        for (var i = 0; i < entries.size() && i < other.entries.size(); i++) {
            if (!entries.get(i).equals(other.entries.get(i))) {
                return false;
            }
        }
        return true;
    }

    public Universe toUniverse() {
        var universe = new Universe();
        for (var entry : entries) {
            switch (entry) {
                case Member(var id, var key, var value) -> {
                    universe.getOrCreateObject(id).members.put(key, value);
                }
                default -> {
                }
            }
        }
        return universe;
    }

    public int numDecisions() {
        return (int) entries.stream().filter(entry -> entry instanceof Decision).count();
    }

    public Trace rethinkLastDecisions(Random random) {
        var decisionsToKeep = numDecisions() - 1;
        while (decisionsToKeep > 0) {
            if (random.nextBoolean()) break;
            decisionsToKeep--;
        }
        var newTrace = new Trace();
        var numDecisionsSoFar = 0;
        for (var entry : entries) {
            if (entry instanceof Decision) {
                numDecisionsSoFar++;
                if (numDecisionsSoFar > decisionsToKeep) {
                    var universe = toUniverse();
                    newTrace.add(switch (entry) {
                        case Call(var args) ->
                            new Call(args.stream().map(arg -> universe.rethinkValue(arg, random)).toList());
                        case Member(var id, var key, var value) ->
                            new Member(id, key, universe.rethinkValue(value, random));
                        default ->
                            throw new UnsupportedOperationException("Not supported yet.");
                    });
                    break;
                }
            }
            newTrace.add(entry);
        }
        return newTrace;
    }

    public Trace deduplicate() {
        var result = new Trace();
        var members = new HashSet<TraceEntry>();
        for (var i = 0; i < entries.size(); i++) {
            var entry = entries.get(i);
            if (entry instanceof QueryMember) {
                if (members.contains(entry)) {
                    i++; // skip (consistent) answer
                    continue;
                }
                members.add(entry);
            }
            result.add(entry);
        }
        return result;
    }

    @Override
    public boolean equals(Object obj) {
        if (this == obj)
            return true;
        if (!(obj instanceof Trace other))
            return false;
        return entries.equals(other.entries);
    }

    @Override
    public int hashCode() {
        return entries.hashCode();
    }
}
