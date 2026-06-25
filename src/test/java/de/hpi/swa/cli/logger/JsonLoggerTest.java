package de.hpi.swa.cli.logger;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import de.hpi.swa.analysis.Group;
import de.hpi.swa.generator.Run;
import de.hpi.swa.generator.Runner.FunctionResult;
import de.hpi.swa.generator.Trace;
import de.hpi.swa.generator.Universe;
import de.hpi.swa.generator.Value;

import org.junit.Before;
import org.junit.After;
import org.junit.Test;
import static org.junit.Assert.*;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class JsonLoggerTest {

    private JsonLogger logger;
    private ByteArrayOutputStream outputStream;
    private PrintStream originalOut;

    @Before
    public void setUp() {
        outputStream = new ByteArrayOutputStream();
        originalOut = System.out;
        PrintStream redirected = new PrintStream(outputStream);
        System.setOut(redirected);
        logger = new JsonLogger(redirected, null);
    }

    @After
    public void tearDown() {
        System.setOut(originalOut);
    }

    private String getCapturedOutput() {
        return outputStream.toString().trim();
    }

    private Run createMockRun(String inputType, String outputType, boolean crashed) {
        Universe universe = new Universe();
        Value input = createMockValue(inputType, universe);
        FunctionResult output = crashed
                ? new FunctionResult.Crash("TestError: Something went wrong", List.of("at line 1", "at line 2"))
                : new FunctionResult.Normal(outputType, "testValue");
        Trace trace = new Trace();
        return new Run(universe, List.of(input), output, trace, new de.hpi.swa.coverage.Coverage());
    }

    private Value createMockValue(String type, Universe universe) {
        return switch (type) {
            case "int" -> new Value.Int(42);
            case "double" -> new Value.Double(3.14);
            case "string" -> new Value.StringValue("test");
            case "boolean" -> new Value.Boolean(true);
            case "object" -> new Value.ObjectValue(universe.createObject());
            default -> new Value.Null();
        };
    }

    @Test
    public void testLogProgress() {
        logger.logProgress(123);

        JsonObject json = JsonParser.parseString(getCapturedOutput()).getAsJsonObject();
        assertEquals("progress", json.get("type").getAsString());
        assertEquals(123, json.get("count").getAsInt());
    }

    @Test
    public void testLogAnalysisRootAggregations() {
        Map<String, Object> aggregations = new LinkedHashMap<>();
        aggregations.put("Count", 5);
        aggregations.put("CrashCount", 1);

        logger.logAnalysis("testQuery", Group.rootWith(aggregations));

        JsonObject json = JsonParser.parseString(getCapturedOutput()).getAsJsonObject();
        assertEquals("analysis", json.get("type").getAsString());
        assertEquals("testQuery", json.get("query").getAsString());

        JsonObject root = json.getAsJsonObject("root");
        assertEquals("All", root.get("key").getAsString());
        JsonObject aggs = root.getAsJsonObject("aggregations");
        assertEquals(5, aggs.get("Count").getAsInt());
        assertEquals(1, aggs.get("CrashCount").getAsInt());
    }

    @Test
    public void testLogAnalysisKeyIsPlainString() {
        logger.logAnalysis("testQuery", Group.leaf("int", Map.of("Count", 10), List.of()));

        JsonObject root = JsonParser.parseString(getCapturedOutput())
                .getAsJsonObject().getAsJsonObject("root");
        // The key is now a display string, not a structured object.
        assertEquals("int", root.get("key").getAsString());
        assertEquals(10, root.getAsJsonObject("aggregations").get("Count").getAsInt());
    }

    @Test
    public void testLogAnalysisWithChildren() {
        Group child = Group.leaf("int", Map.of("Count", 5), List.of());
        Group root = Group.root(List.of(child));

        logger.logAnalysis("testQuery", root);

        JsonObject rootJson = JsonParser.parseString(getCapturedOutput())
                .getAsJsonObject().getAsJsonObject("root");
        JsonArray children = rootJson.getAsJsonArray("children");
        assertEquals(1, children.size());
        JsonObject childJson = children.get(0).getAsJsonObject();
        assertEquals("int", childJson.get("key").getAsString());
        assertEquals(5, childJson.getAsJsonObject("aggregations").get("Count").getAsInt());
    }

    @Test
    public void testLogAnalysisWithSamples() {
        Group root = Group.rootSamples(List.of(
                createMockRun("int", "string", false),
                createMockRun("double", "int", false)));

        logger.logAnalysis("testQuery", root);

        JsonObject rootJson = JsonParser.parseString(getCapturedOutput())
                .getAsJsonObject().getAsJsonObject("root");
        assertEquals(2, rootJson.get("sampleCount").getAsInt());

        JsonArray samples = rootJson.getAsJsonArray("samples");
        assertEquals(2, samples.size());
        JsonObject input1 = samples.get(0).getAsJsonObject().getAsJsonArray("args").get(0).getAsJsonObject();
        assertEquals("Int", input1.get("type").getAsString());
    }
}
