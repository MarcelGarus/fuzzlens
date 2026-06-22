# GraalFuzz 

Fuzzing dynamic languages implemented with GraalVM's Truffle framework.

## Java Maven Project

### Getting Started

For development, you can use Oracle JDK 21, OpenJDK 21, or any of its derivatives.
Use GraalVM version 25.0.1 (https://www.graalvm.org/downloads/).

### Maven

To directly use the command line, this might be helpful:

#### Compile ...

```bash
mvn compile
```

Or for native image:
```bash
mvn -P native package
```

#### Run Tests

```bash
mvn test
```

#### Running the main class

After compiling, run the CLI via Maven's exec plugin:

```bash
mvn exec:java -Dexec.args="--file examples/program.py"
```

#### Cleanup

```bash
mvn clean
```

### Running the CLI

After compiling, run the `de.hpi.swa.cli.FuzzMain` entry point via Maven's exec
plugin, which resolves the classpath and launches the JVM for you:

#### Usage
```bash
mvn exec:java -Dexec.args="[options]"
```

#### Options
- `--language <lang>` or `-l <lang>`: Specify the language (default: `python`)
  - Also supports: `--language=<lang>` format
- `--code <code>` or `-c <code>`: Execute inline code
  - Supports `\n` and `\t` escape sequences
  - Also supports: `--code=<code>` format
- `--file <path>` or `-f <path>`: Execute code from file
  - Also supports: `--file=<path>` format
- `--no-color`: Disable ANSI color output (useful for terminals that don't support colors)
- `--tooling`: Output results as JSON Lines format (JSONL) for machine consumption

Note that the provided code must always evaluate to a function. In Python, for example, the last line should reference the function to be fuzzed.

#### Examples
```bash
# Run with default Python program
mvn exec:java

# Run a specific file
mvn exec:java -Dexec.args="--file examples/program.py"

# Run inline code (use \n for newlines; the last line must reference the function)
mvn exec:java -Dexec.args="--code 'def f(x): return x.foo\nf'"

# Output as JSON for tooling integration
mvn exec:java -Dexec.args="--tooling" > results.jsonl

# Run JavaScript code
mvn exec:java -Dexec.args="--language js --file examples/program.js"
```

#### Output Modes

*Default mode* (human-readable):
- Results printed to stdout with ANSI colors
- Diagnostic messages to stderr
- Format: `<input>  Trace: <colored trace>`

*No color mode* (`--no-color` flag):
- Results printed to stdout without ANSI colors
- Diagnostic messages to stderr
- Format: `<input>  Trace: <plain trace>`
- Designed for terminals that do not support colors, e.g. VS Code Output panel

*Tooling mode* (`--tooling` flag):
- One JSON object per line (JSONL format) to stdout
- All diagnostic messages to stderr
- Designed for VS Code extension and other tooling integration

#### JSON Output Format

Each line contains a complete fuzzing run result with:
- `universe`: All objects that exist in this run (identified by ID), nested members referenced by ID.
- `input`: The input value (primitive or object reference)
- `trace`: Sequence of trace entries (Call → QueryMember/Member → Return/Crash)

**Trace entry types:**
- `Call`: Function invocation with argument
- `QueryMember`: Checking if object has a member
- `Member`: Accessing object member (with value if it exists)
- `Return`: Successful execution with return value
- `Crash`: Execution failed with error message

**Value types:**
- `Null`, `Boolean`, `Int`, `Double`, `String`: Primitive values
- `Object`: Reference to object in universe by ID

**Example 1: Successful execution with object property access**
```json
{
  "universe": {
    "objects": {
      "$0": {
        "members": {
          "foo": {
            "type": "Object",
            "id": {"value": 1}
          }
        }
      },
      "$1": {
        "members": {
          "bar": {
            "type": "Int",
            "value": 42
          }
        }
      }
    }
  },
  "input": {
    "type": "Object",
    "id": {"value": 0}
  },
  "trace": {
    "entries": [
      {"type": "Call", "arg": {"id": {"value": 0}}},
      {"type": "QueryMember", "id": {"value": 0}, "key": "foo"},
      {"type": "Member", "id": {"value": 0}, "key": "foo", "value": {"id": {"value": 1}}},
      {"type": "QueryMember", "id": {"value": 1}, "key": "bar"},
      {"type": "Member", "id": {"value": 1}, "key": "bar", "value": {"value": 42}},
      {"type": "Return", "value": "123"}
    ]
  }
}
```

**Example 2: Crash with missing attribute**
```json
{
  "universe": {
    "objects": {
      "$0": {
        "members": {}
      }
    }
  },
  "input": {
    "type": "Object",
    "id": {"value": 0}
  },
  "trace": {
    "entries": [
      {"type": "Call", "arg": {"id": {"value": 0}}},
      {"type": "QueryMember", "id": {"value": 0}, "key": "foo"},
      {"type": "Member", "id": {"value": 0}, "key": "foo"},
      {"type": "Crash", "message": "AttributeError: foreign object has no attribute 'foo'"}
    ]
  }
}
```

**Example 3: Primitive input values**
```json
{
  "universe": {"objects": {}},
  "input": {
    "type": "Int",
    "value": 42
  },
  "trace": {
    "entries": [
      {"type": "Call", "arg": {"value": 42}},
      {"type": "Crash", "message": "AttributeError: 'int' object has no attribute 'foo'"}
    ]
  }
}
```

**Example 4: Null value in object member**
```json
{
  "universe": {
    "objects": {
      "$0": {
        "members": {
          "foo": {"type": "Null"}
        }
      }
    }
  },
  "input": {
    "type": "Object",
    "id": {"value": 0}
  },
  "trace": {
    "entries": [
      {"type": "Call", "arg": {"id": {"value": 0}}},
      {"type": "QueryMember", "id": {"value": 0}, "key": "foo"},
      {"type": "Member", "id": {"value": 0}, "key": "foo", "value": {}},
      {"type": "Crash", "message": "AttributeError: foreign object has no attribute 'bar'"}
    ]
  }
}
```

## VS Code Extension
See [vscode-extension/README.md](vscode-extension/README.md) for details.