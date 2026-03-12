# FuzzLens VS Code Extension

FuzzLens integrates the GraalFuzz backend into VS Code so you can fuzz functions and inspect observed input/output behavior directly in the editor.

## What it currently provides

- A dedicated **FuzzLens** activity bar container with two views:
    - **Functions**: workspace function explorer for supported files.
    - **Results**: grouped fuzzing results (including successful and crashing samples).
- Commands to fuzz:
    - the function at the current cursor,
    - or a selected function from the **Functions** tree.
- Inline examples next to function definitions (`input -> output` / crash), including manual and automatic rotation.
- Hover information on function names with observed signature, type mappings, exception summary, and example values.

## Supported languages

- Python (`.py`)
- JavaScript (`.js`, `.mjs`)

## Prerequisites

This extension runs the repository-local backend scripts:

- Windows: `../graalfuzz.cmd`
- Unix/macOS: `../graalfuzz.sh`

Because these scripts invoke Maven and run the Java backend, you need:

- JDK 21
- Maven
- A compiled backend in the repository root (`mvn compile`)

## Start the project (local development)

From the repository root:

1. Build backend classes once:

     ```bash
     mvn compile
     ```

2. Install extension dependencies:

     ```bash
     cd vscode-extension
     npm install
     ```

3. Start extension build/watch:

     ```bash
     npm run watch
     ```

4. In VS Code, run the extension in a Development Host (`F5`).

Notes:
- Re-run `mvn compile` after backend Java changes.
- Keep Maven available in `PATH` while using the extension.

## How to use

1. Open a supported Python/JavaScript file containing functions.
2. Run one of:
     - **FuzzLens: Fuzz Function** (from the Functions tree item menu)
     - **FuzzLens: Run Fuzzer** (F1 command for current cursor function / whole-file fallback)
3. Inspect results in:
     - **FuzzLens Functions** (run state per function)
     - **FuzzLens Results** (grouped analysis and samples)
     - hover on function names in the editor
     - inline examples next to the function

## Commands

- `FuzzLens: Run Fuzzer`
- `FuzzLens: Fuzz Function`
- `FuzzLens: Re-run Fuzzer`
- `FuzzLens: Stop Fuzzer`
- `FuzzLens: Toggle Inline Examples`
- `FuzzLens: Next Inline Example`
- `FuzzLens: Previous Inline Example`
- `FuzzLens: Pause Example Rotation`
- `FuzzLens: Resume Example Rotation`
- `FuzzLens: Refresh`
- `FuzzLens: Open Query Editor` (coming soon    )

## Keyboard shortcuts

- `Alt+.` → Next inline example
- `Alt+,` → Previous inline example
- `Alt+/` → Pause example rotation

## Extension settings

- `fuzzlens.showInlineExamples` (default: `true`)
    - Show inline example decorations next to function definitions.
- `fuzzlens.maxInlineExamples` (default: `3`, range: `1..10`)
    - Maximum number of inline examples shown per function.
- `fuzzlens.maxInlineExampleLength` (default: `40`, range: `10..100`)
    - Maximum inline example text length (truncated with `...`).
- `fuzzlens.iterations` (default: `1000`, range: `100..10000`)
    - Number of fuzzing iterations.
- `fuzzlens.inlineExamples.autoRotate` (default: `true`)
    - Start automatic inline example rotation when results are available.
- `fuzzlens.inlineExamples.rotationInterval` (default: `5000`, range: `1000..30000`)
    - Rotation interval in milliseconds.
- `fuzzlens.cacheSize` (default: `50`, range: `10..500`)
    - Maximum number of cached function results.
- `fuzzlens.explorer.ignoredFolders`
    - Folder names ignored while scanning the workspace for supported files.
    - Default includes: `node_modules`, `venv`, `.venv`, `dist`, `build`, `target`, `out`, `.git`, and common cache folders.

## Current limitations

- Query editor UI is not implemented yet.
- Hover details are primarily implemented for function-name hovers.
- The extension currently expects repository-local backend scripts one directory above `vscode-extension`.
- Functions with multiple arguments
- lists, dictionary accesses, higher order functions, method calls, or functions with side effects, are not supported yet.