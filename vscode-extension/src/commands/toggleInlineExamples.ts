import * as vscode from 'vscode';
import { FuzzLensContext } from '../types/context';

/**
 * Toggle inline example decorations on/off.
 * When enabled, shows example inputs → outputs next to function definitions.
 */
const toggleInlineExamples = (ctx: FuzzLensContext) => async () => {
    const config = vscode.workspace.getConfiguration('fuzzlens');
    const currentValue = config.get<boolean>('showInlineExamples', true);

    await config.update('showInlineExamples', !currentValue, vscode.ConfigurationTarget.Workspace);

    const status = !currentValue ? 'enabled' : 'disabled';
    vscode.window.showInformationMessage(`Inline examples ${status}`);

    ctx.events.onInlineExamplesToggled?.fire(!currentValue);
};

export default toggleInlineExamples;
