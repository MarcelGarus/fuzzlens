#!/bin/bash
# Launches the long-lived GraalFuzz daemon (de.hpi.swa.cli.DaemonMain), which
# serves fuzzing requests over newline-delimited JSON on stdin/stdout. Unlike
# graalfuzz.sh (one JVM per run), this process stays alive and keeps the GraalVM
# engine warm, so each request reuses the initialized runtime instead of paying
# cold-start on every edit.

# Resolve script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Get classpath from Maven
CLASSPATH=$(mvn -q exec:exec -Dexec.executable=echo -Dexec.args=\%classpath)
CLASSPATH="${CLASSPATH}:${SCRIPT_DIR}/target/classes"

# Use JAVA_HOME if set
if [ -z "$JAVA_HOME" ]; then
    JAVA="java"
else
    JAVA="$JAVA_HOME/bin/java"
fi

exec "$JAVA" -cp "$CLASSPATH" de.hpi.swa.cli.DaemonMain "$@"
