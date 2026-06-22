package de.hpi.swa.cli;

/**
 * A controlled, user-facing failure of a fuzzing request (e.g. the requested
 * function doesn't exist or isn't callable). The CLI prints the message and
 * exits non-zero; the daemon reports it as an {@code error} response without
 * tearing down the warm engine.
 */
public class FuzzException extends Exception {
    public FuzzException(String message) {
        super(message);
    }
}
