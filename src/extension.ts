import * as vscode from 'vscode';
import { loadEnvironment, type EnvironmentResult, type LoadConfig } from './environment';
import { DashboardPanel } from './dashboard';
import {
	getLanguageServers,
	restartLanguageServers,
	type LanguageServer,
} from './language-servers';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let isLoading = false;
let pendingReload = false;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

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

	// ── File watcher for auto-reload ─────────────────────────
	setupFileWatcher(context);

	// ── Initial load ─────────────────────────────────────────
	runLoad(context);
}

export function deactivate() {
	if (debounceTimer !== undefined) {
		clearTimeout(debounceTimer);
	}
}

// ---------------------------------------------------------------------------
// File watcher
// ---------------------------------------------------------------------------

function setupFileWatcher(context: vscode.ExtensionContext) {
	const config = vscode.workspace.getConfiguration('flakeenv');
	if (!config.get<boolean>('autoReload', true)) {
		return;
	}

	const watcher = vscode.workspace.createFileSystemWatcher('**/flake.nix');
	const watcherEnvrc = vscode.workspace.createFileSystemWatcher('**/.envrc');

	const scheduleReload = () => {
		const cfg = vscode.workspace.getConfiguration('flakeenv');
		const debounceMs = cfg.get<number>('autoReloadDebounceMs', 1000);

		if (debounceTimer !== undefined) {
			clearTimeout(debounceTimer);
		}
		debounceTimer = setTimeout(() => {
			debounceTimer = undefined;
			if (isLoading) {
				pendingReload = true;
				return;
			}
			log('File change detected — reloading environment…');
			runLoad(context);
		}, debounceMs);
	};

	watcher.onDidChange(scheduleReload);
	watcherEnvrc.onDidChange(scheduleReload);

	context.subscriptions.push(watcher, watcherEnvrc);
}

// ---------------------------------------------------------------------------
// Load orchestrator
// ---------------------------------------------------------------------------

async function runLoad(context: vscode.ExtensionContext): Promise<void> {
	if (isLoading) {
		pendingReload = true;
		DashboardPanel.pushLoading();
		return;
	}

	isLoading = true;
	pendingReload = false;
	setStatus('loading', '$(sync~spin) FlakeEnv');
	DashboardPanel.pushLoading();

	try {
		const config = vscode.workspace.getConfiguration('flakeenv');
		const loadConfig: LoadConfig = {
			additionalBlockedVars: config.get<string[]>('additionalBlockedVars', []),
			additionalBlockedPrefixes: config.get<string[]>('additionalBlockedPrefixes', []),
			execTimeoutMs: config.get<number>('execTimeoutMs', 120000),
		};
		const result = await loadEnvironment(context, log, loadConfig);
		applyStatus(result);

		// Restart language servers that may have started before the
		// environment was ready (e.g. rust-analyzer without cargo in PATH).
		if (result.status === 'ok' && result.injected.length > 0) {
			const userServers = config.get<LanguageServer[]>('languageServers', []);
			const servers = getLanguageServers(userServers);
			await restartLanguageServers(servers, log);
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		log(`✗ Unexpected error: ${msg}`);
		vscode.window.showWarningMessage(`FlakeEnv: ${msg}`);
		setStatus('error', '$(warning) FlakeEnv');
	} finally {
		isLoading = false;
		// If a reload was queued while we were loading, run it now
		if (pendingReload) {
			pendingReload = false;
			runLoad(context);
		}
	}
}

function applyStatus(result: EnvironmentResult): void {
	switch (result.status) {
		case 'ok':
			setStatus('ok', `$(check) FlakeEnv: ${result.injected.length} vars`);
			statusBarItem.tooltip = `FlakeEnv: ${result.injected.length} vars (nix: ${result.nixCount}, direnv: ${result.direnvCount})\nClick to open dashboard`;
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
		state === 'error' ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
	statusBarItem.show();
}
