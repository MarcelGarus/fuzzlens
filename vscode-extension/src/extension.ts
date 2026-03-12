import * as vscode from 'vscode';

import runFuzzerOnCurrentFile from './commands/runFuzzerOnCurrentFile';
import runFuzzerOnFunction from './commands/runFuzzerOnFunction';
import stopFuzzer from './commands/stopFuzzer';
import toggleInlineExamples from './commands/toggleInlineExamples';
import refresh from './commands/refresh';
import { cleanup } from './services/fuzzer';
import { createContext, FuzzLensContext } from './types/context';
import { setupFuzzerResultsListener, showNextExample, showPreviousExample, pauseRotation, resumeRotation } from './fuzzlens/inlineExamples';
import { FunctionsTreeProvider, ResultsTreeProvider } from './fuzzlens/treeView';
import { registerHoverProvider } from './fuzzlens/hoverProvider';
import selectFunction from './commands/selectFunction';

// Store for access in deactivate
let extensionContext: FuzzLensContext;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log('Extension "FuzzLens" active. Using CLI backend.');

	extensionContext = createContext({
		context, providers: {
			functionsTree: new FunctionsTreeProvider(extensionContext),
			resultsTree: new ResultsTreeProvider(extensionContext)
		}
	});

	const functionsTreeView = vscode.window.createTreeView('fuzzlens.functions', {
		treeDataProvider: extensionContext.providers.functionsTree,
		showCollapseAll: true
	});

	const resultsTreeView = vscode.window.createTreeView('fuzzlens.results', {
		treeDataProvider: extensionContext.providers.resultsTree,
		showCollapseAll: true
	});

	const hoverProvider = registerHoverProvider(extensionContext);

	const fuzzlensRunCmd = vscode.commands.registerCommand('fuzzlens.runFuzzer', runFuzzerOnCurrentFile(extensionContext));
	const fuzzlensRunOnFunctionCmd = vscode.commands.registerCommand('fuzzlens.runFuzzerOnFunction', runFuzzerOnFunction(extensionContext));
	const fuzzlensRerunCmd = vscode.commands.registerCommand('fuzzlens.rerunFuzzer', runFuzzerOnFunction(extensionContext));
	const fuzzlensStopCmd = vscode.commands.registerCommand('fuzzlens.stopFuzzer', stopFuzzer(extensionContext));
	const fuzzlensToggleInlineCmd = vscode.commands.registerCommand('fuzzlens.toggleInlineExamples', toggleInlineExamples(extensionContext));
	const fuzzlensRefreshCmd = vscode.commands.registerCommand('fuzzlens.refresh', refresh(extensionContext));
	const fuzzlensOpenQueryEditorCmd = vscode.commands.registerCommand('fuzzlens.openQueryEditor', () => {
		// TODO: Open query editor webview panel
		vscode.window.showInformationMessage('Query Editor coming soon!');
	});
	const fuzzlensNextExampleCmd = vscode.commands.registerCommand('fuzzlens.nextExample', () => showNextExample(extensionContext));
	const fuzzlensPrevExampleCmd = vscode.commands.registerCommand('fuzzlens.prevExample', () => showPreviousExample(extensionContext));
	const fuzzlensPauseRotationCmd = vscode.commands.registerCommand('fuzzlens.pauseRotation', () => pauseRotation(extensionContext));
	const fuzzlensResumeRotationCmd = vscode.commands.registerCommand('fuzzlens.resumeRotation', () => resumeRotation(extensionContext));
	const fuzzlensSelectFunctionCmd = vscode.commands.registerCommand('fuzzlens.selectFunction', selectFunction(extensionContext));

	const fuzzerResultsListener = setupFuzzerResultsListener(extensionContext);
	const onResultsReady = extensionContext.events.onFuzzerResultsReady.event((processState) => {
		extensionContext.providers.functionsTree.refresh();
		extensionContext.providers.resultsTree.setResults(processState);
	});

	context.subscriptions.push(
		// Views
		functionsTreeView,
		resultsTreeView,
		// Hover Provider
		hoverProvider,
		// New FuzzLens commands
		fuzzlensRunCmd,
		fuzzlensRunOnFunctionCmd,
		fuzzlensRerunCmd,
		fuzzlensStopCmd,
		fuzzlensToggleInlineCmd,
		fuzzlensRefreshCmd,
		fuzzlensOpenQueryEditorCmd,
		fuzzlensNextExampleCmd,
		fuzzlensPrevExampleCmd,
		fuzzlensPauseRotationCmd,
		fuzzlensResumeRotationCmd,
		fuzzlensSelectFunctionCmd,
		// Listeners
		extensionContext.output,
		fuzzerResultsListener,
		onResultsReady
	);
}

// This method is called when your extension is deactivated
export function deactivate() {
	cleanup(extensionContext.state);
}
