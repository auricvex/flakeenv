import * as vscode from 'vscode';
import { loadEnvironment, type EnvironmentResult } from './environment';
import { DashboardPanel } from './dashboard';

// ---------------------------------------------------------------------------
// Known language servers to restart after environment injection
// ---------------------------------------------------------------------------

const KNOWN_LANGUAGE_SERVERS: ReadonlyArray<{
	extensionId: string;
	command: string;
	name: string;
}> = [
		{ extensionId: 'rust-lang.rust-analyzer', command: 'rust-analyzer.restartServer', name: 'rust-analyzer' },
		{ extensionId: 'vadimcn.vscode-lldb', command: 'lldb.restart', name: 'CodeLLDB' },
	];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let isLoading = false;

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext) {
	outputChannel = vscode.window.createOutputChannel('FlakeEnv');
	context.subscriptions.push(outputChannel);

	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
	statusBarItem.command = 'flakeenv.openDashboard';
	context.subscriptions.push(statusBarItem);

	// ── Commands ──────────────────────────────────────────────
	const reloadCmd = vscode.commands.registerCommand('flakeenv.reload', () => runLoad(context));
	context.subscriptions.push(reloadCmd);

	const dashboardCmd = vscode.commands.registerCommand('flakeenv.openDashboard', () => {
		DashboardPanel.createOrShow(context.extensionUri);
	});
	context.subscriptions.push(dashboardCmd);

	// ── Initial load ─────────────────────────────────────────
	runLoad(context);
}

export function deactivate() { }

// ---------------------------------------------------------------------------
// Load orchestrator
// ---------------------------------------------------------------------------

async function runLoad(context: vscode.ExtensionContext): Promise<void> {
	if (isLoading) {
		DashboardPanel.pushLoading();
		vscode.window.showWarningMessage('FlakeEnv: already loading, please wait…');
		return;
	}

	isLoading = true;
	setStatus('loading', '$(sync~spin) FlakeEnv');
	DashboardPanel.pushLoading();

	try {
		const result = await loadEnvironment(context, log);
		applyStatus(result);

		// Restart language servers that may have started before the
		// environment was ready (e.g. rust-analyzer without cargo in PATH).
		if (result.status === 'ok' && result.injected.length > 0) {
			await restartLanguageServers(log);
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		log(`✗ Unexpected error: ${msg}`);
		vscode.window.showWarningMessage(`FlakeEnv: ${msg}`);
		setStatus('error', '$(warning) FlakeEnv');
	} finally {
		isLoading = false;
	}
}

function applyStatus(result: EnvironmentResult): void {
	switch (result.status) {
		case 'ok':
			setStatus('ok', `$(check) FlakeEnv: ${result.injected.length} vars`);
			statusBarItem.tooltip =
				`FlakeEnv: ${result.injected.length} vars (nix: ${result.nixCount}, direnv: ${result.direnvCount})\nClick to open dashboard`;
			break;
		case 'error':
			vscode.window.showWarningMessage(`FlakeEnv: ${result.errorMessage ?? 'Unknown error'}`);
			setStatus('error', '$(warning) FlakeEnv');
			statusBarItem.tooltip = `FlakeEnv: Error — ${result.errorMessage}\nClick to open dashboard`;
			break;
		case 'empty':
			statusBarItem.hide();
			break;
	}
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function log(msg: string) {
	const ts = new Date().toLocaleTimeString();
	outputChannel.appendLine(`[${ts}] ${msg}`);
}

function setStatus(state: 'loading' | 'ok' | 'error', text: string) {
	statusBarItem.text = text;
	statusBarItem.backgroundColor =
		state === 'error'
			? new vscode.ThemeColor('statusBarItem.warningBackground')
			: undefined;
	statusBarItem.show();
}

// ---------------------------------------------------------------------------
// Language server restart
// ---------------------------------------------------------------------------

async function restartLanguageServers(log: (msg: string) => void): Promise<void> {
	// Brief delay to let language servers finish their initial (failed) startup
	// before we ask them to restart with the corrected environment.
	await new Promise(resolve => setTimeout(resolve, 1500));

	for (const { extensionId, command, name } of KNOWN_LANGUAGE_SERVERS) {
		const ext = vscode.extensions.getExtension(extensionId);
		if (!ext) {
			continue;
		}

		try {
			await vscode.commands.executeCommand(command);
			log(`↻ Restarted ${name} to pick up new environment.`);
		} catch {
			log(`⚠ Could not restart ${name} (command "${command}" unavailable).`);
		}
	}
}