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

#### Cleanup

```bash
mvn clean
```

### Backend daemon

The Java backend is a long-lived **daemon** (`de.hpi.swa.cli.DaemonMain`), not a
command-line tool. The VS Code extension launches it via `graalfuzz-daemon.sh`
(or `graalfuzz-daemon.cmd`); it keeps a warm GraalVM engine and serves fuzzing
requests over a newline-delimited JSON protocol on stdin/stdout:

- **Request** — one JSON object per line: a fuzzing request carrying an `id`,
  `language`, `code` (or `file`), `function`, `iterations`, and `queries`; or
  `{"id": N, "op": "cancel"}` to abort an in-flight run.
- **Response** — id-tagged lines: `progress` counts and curated `analysis`
  snapshots (grouped views, inline examples, per-return-line examples) that
  improve as the run proceeds, terminated by `done` (or `error`).

There is no standalone CLI mode — drive the backend through the extension.

## VS Code Extension
See [vscode-extension/README.md](vscode-extension/README.md) for details.