package de.hpi.swa.cli.logger;

import de.hpi.swa.analysis.Group;
import de.hpi.swa.generator.Run;
import de.hpi.swa.generator.Value;

public class ConsoleLogger implements ResultLogger {
    private final boolean color;

    public ConsoleLogger(boolean color) {
        this.color = color;
    }

    @Override
    public void logRun(Run result) {
        System.out.print("New run. ");
        System.out.print(String.format("%-20s", Value.format(result.getInput(), result.getUniverse())));
        System.out.print("  Trace: " + result.getTrace().toString(color));
        System.out.println();
    }

    @Override
    public void logAnalysis(String queryName, Group root) {
        System.out.println("\n--- Analysis Summary: " + queryName + " ---");
        printGroup(root, 0);
    }

    private void printGroup(Group group, int indentLevel) {
        String indent = "  ".repeat(indentLevel);
        String aggs = group.aggregations().isEmpty() ? "" : " " + group.aggregations();
        System.out.println(indent + group.key() + aggs);

        for (var child : group.children()) {
            printGroup(child, indentLevel + 1);
        }

        int count = Math.min(3, group.samples().size());
        for (int i = 0; i < count; i++) {
            var result = group.samples().get(i);
            System.out.print(String.format("%s  %-20s", indent,
                    Value.format(result.getInput(), result.getUniverse())));
            System.out.print("  Trace: " + result.getTrace().toString(color));
            System.out.println();
        }
    }
}
