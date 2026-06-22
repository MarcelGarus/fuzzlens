import * as vscode from 'vscode';

// Example "pill" colors.
const CONFIRMED_FOREGROUND = '#1b5e20'; // dark green text
const CONFIRMED_BACKGROUND = '#c8e6c9'; // light green background
// "Pending" pills (e.g. while a function is being re-fuzzed after an edit) are
// greyed out until the fuzzer confirms the example again.
const PENDING_FOREGROUND = '#9e9e9e';
const PENDING_BACKGROUND = '#9e9e9e2b'; // translucent grey

/** Visual state of an example pill. */
export type DecorationVariant = 'confirmed' | 'pending';

interface ActiveDecoration {
  type: vscode.TextEditorDecorationType;
  line: number;
  /** The full (untruncated) example text, so the pill can be re-rendered (e.g. greyed). */
  text: string;
  variant: DecorationVariant;
}

// Track decorations for cleanup and for re-rendering in a different variant.
const activeDecorations: Map<string, ActiveDecoration> = new Map();

export const applyDecoration = (
  editor: vscode.TextEditor,
  line: number,
  suggestion: string,
  variant: DecorationVariant = 'confirmed'
) => {
  // Validate line number (must be >= 1 and <= document line count)
  if (line < 0 || line > editor.document.lineCount) {
    console.warn(`Invalid line number for decoration: ${line} (document has ${editor.document.lineCount} lines)`);
    return;
  }

  const key = `${editor.document.uri.fsPath}:${line}`;

  // Clear previous decoration at this line
  if (activeDecorations.has(key)) {
    activeDecorations.get(key)?.type.dispose();
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
      color: variant === 'pending' ? PENDING_FOREGROUND : CONFIRMED_FOREGROUND,
      backgroundColor: variant === 'pending' ? PENDING_BACKGROUND : CONFIRMED_BACKGROUND,
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
  activeDecorations.set(key, { type: decorationType, line, text: suggestion, variant });
};

/**
 * Re-render every example pill in a file as "pending" (greyed out), keeping its
 * text. Used when a function is edited: the examples stay visible but greyed
 * until the fuzzer re-confirms them.
 */
export const greyOutDecorationsForFile = (editor: vscode.TextEditor, filePath: string) => {
  const toGrey: ActiveDecoration[] = [];
  for (const [key, dec] of activeDecorations.entries()) {
    if (key.startsWith(filePath + ':') && dec.variant !== 'pending') {
      toGrey.push(dec);
    }
  }
  for (const dec of toGrey) {
    applyDecoration(editor, dec.line, dec.text, 'pending');
  }
};

export const clearDecorations = (editor: vscode.TextEditor) => {
  const filePath = editor.document.uri.fsPath;
  const keysToDelete: string[] = [];

  for (const [key, dec] of activeDecorations.entries()) {
    if (key.startsWith(filePath + ':')) {
      dec.type.dispose();
      keysToDelete.push(key);
    }
  }

  for (const key of keysToDelete) {
    activeDecorations.delete(key);
  }
};

export const clearAllDecorations = () => {
  for (const dec of activeDecorations.values()) {
    dec.type.dispose();
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
