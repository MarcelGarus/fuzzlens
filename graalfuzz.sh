#!/bin/bash
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

exec "$JAVA" -cp "$CLASSPATH" de.hpi.swa.cli.FuzzMain "$@"
