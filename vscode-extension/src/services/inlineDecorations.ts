import * as vscode from 'vscode';

// Example "pill" colors.
const EXAMPLE_FOREGROUND = '#1b5e20'; // dark green text
const EXAMPLE_BACKGROUND = '#c8e6c9'; // light green background

// Track decoration types for cleanup
const activeDecorations: Map<string, vscode.TextEditorDecorationType> = new Map();

export const applyDecoration = (editor: vscode.TextEditor, line: number, suggestion: string) => {
  // Validate line number (must be >= 1 and <= document line count)
  if (line < 0 || line > editor.document.lineCount) {
    console.warn(`Invalid line number for decoration: ${line} (document has ${editor.document.lineCount} lines)`);
    return;
  }

  const key = `${editor.document.uri.fsPath}:${line}`;

  // Clear previous decoration at this line
  if (activeDecorations.has(key)) {
    activeDecorations.get(key)?.dispose();
    activeDecorations.delete(key);
  }

  // Calculate max length based on existing line content
  const lineLength = editor.document.lineAt(line).text.length;
  const maxTotalLength = 180;
  const availableLength = Math.max(50, maxTotalLength - lineLength); // min 50 chars for decoration
  const substring = truncateSuggestion(suggestion, availableLength);
  const decorationType = vscode.window.createTextEditorDecorationType({
    after: {
      contentText: substring,
      color: EXAMPLE_FOREGROUND,
      backgroundColor: EXAMPLE_BACKGROUND,
      fontStyle: 'italic',
      // Space between the code and the example pill.
      margin: '0 0 0 2rem',
      // ThemableDecorationAttachmentRenderOptions has no padding/border-radius
      // fields, but `textDecoration` is injected as raw CSS — use it to give the
      // pill symmetric inner padding and rounded corners.
      textDecoration: 'none; padding: 1px 8px; border-radius: 4px;'
    }
  });

  const range = new vscode.Range(
    new vscode.Position(line, lineLength),
    new vscode.Position(line, lineLength)
  );

  const decoration = { range: range, hoverMessage: suggestion };

  editor.setDecorations(decorationType, [decoration]);
  activeDecorations.set(key, decorationType);
};

export const clearDecorations = (editor: vscode.TextEditor) => {
  const filePath = editor.document.uri.fsPath;
  const keysToDelete: string[] = [];

  for (const [key, decorationType] of activeDecorations.entries()) {
    if (key.startsWith(filePath + ':')) {
      decorationType.dispose();
      keysToDelete.push(key);
    }
  }

  for (const key of keysToDelete) {
    activeDecorations.delete(key);
  }
};

export const clearAllDecorations = () => {
  for (const decorationType of activeDecorations.values()) {
    decorationType.dispose();
  }
  activeDecorations.clear();
};

const truncateSuggestion = (suggestion: string, maxLength: number = 80): string => {
  if (suggestion.length <= maxLength) {
    return suggestion;
  }

  // Try to preserve structure for object-like strings
  if (suggestion.includes('→')) {
    const parts = suggestion.split('→');
    if (parts.length === 2) {
      const input = parts[0].trim();
      const output = parts[1].trim();
      const halfMax = Math.floor(maxLength / 2) - 3;
      const truncInput = input.length > halfMax ? input.substring(0, halfMax - 3) + '...' : input;
      const truncOutput = output.length > halfMax ? output.substring(0, halfMax - 3) + '...' : output;
      return `${truncInput} → ${truncOutput}`;
    }
  }

  return suggestion.substring(0, maxLength - 3) + '...';
};
