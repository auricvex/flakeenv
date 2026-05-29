import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { getDashboardUi } from './dashboard-ui';
import { getLastResult, onEnvironmentChange, type EnvironmentResult } from './environment';

// ---------------------------------------------------------------------------
// Dashboard Panel — Singleton webview for inspecting environment variables
// ---------------------------------------------------------------------------

export class DashboardPanel {
	public static readonly viewType = 'flakeenv.dashboard';

	private static instance: DashboardPanel | undefined;
	private readonly panel: vscode.WebviewPanel;
	private readonly extensionUri: vscode.Uri;
	private readonly disposables: vscode.Disposable[] = [];

	private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
		this.panel = panel;
		this.extensionUri = extensionUri;

		// Handle messages from the webview
		this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg), null, this.disposables);

		// Listen for environment changes and push updates
		this.disposables.push(
			onEnvironmentChange((result) => {
				this.postUpdate(result);
			}),
		);

		// Clean up on dispose
		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

		// Update webview content after listeners are attached so the initial
		// `ready` message cannot race and get dropped.
		this.updateHtml();
		this.pushInitialSnapshot();
	}

	/**
	 * Creates or reveals the dashboard panel.
	 */
	public static createOrShow(extensionUri: vscode.Uri): DashboardPanel {
		// If we already have a panel, reveal it
		if (DashboardPanel.instance) {
			DashboardPanel.instance.panel.reveal(vscode.ViewColumn.One);
			const result = getLastResult();
			if (result) {
				DashboardPanel.instance.postUpdate(result);
			}
			return DashboardPanel.instance;
		}

		// Create a new panel
		const panel = vscode.window.createWebviewPanel(
			DashboardPanel.viewType,
			'FlakeEnv Dashboard',
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [extensionUri],
			},
		);

		panel.iconPath = vscode.Uri.joinPath(extensionUri, 'icon.png');

		DashboardPanel.instance = new DashboardPanel(panel, extensionUri);
		return DashboardPanel.instance;
	}

	/**
	 * Push environment data to the webview if it's open.
	 */
	public static pushUpdate(result: EnvironmentResult): void {
		if (DashboardPanel.instance) {
			DashboardPanel.instance.postUpdate(result);
		}
	}

	/**
	 * Let the webview show immediate feedback while a reload is running.
	 */
	public static pushLoading(): void {
		if (DashboardPanel.instance) {
			DashboardPanel.instance.panel.webview.postMessage({ type: 'loading' });
		}
	}

	private updateHtml(): void {
		const nonce = crypto.randomBytes(16).toString('hex');
		this.panel.webview.html = getDashboardUi(this.panel.webview, this.extensionUri, nonce);
	}

	private postUpdate(result: EnvironmentResult): void {
		this.panel.webview.postMessage({ type: 'update', data: result });
	}

	private pushInitialSnapshot(): void {
		const result = getLastResult();
		if (!result) {
			return;
		}

		// Send multiple bootstrap updates to avoid UI stalls if the first
		// message lands before the webview script is fully initialized.
		const attempts = [0, 100, 400, 1200];
		for (const delay of attempts) {
			setTimeout(() => {
				if (!this.panel.visible) {
					return;
				}
				this.postUpdate(result);
			}, delay);
		}
	}

	private onMessage(msg: { type: string; value?: string }): void {
		switch (msg.type) {
			case 'ready': {
				// Webview loaded — send current data and auto-reload state
				const result = getLastResult();
				if (result) {
					this.postUpdate(result);
				}
				const config = vscode.workspace.getConfiguration('flakeenv');
				const autoReload = config.get<boolean>('autoReload', true);
				this.panel.webview.postMessage({ type: 'autoReloadState', enabled: autoReload });
				break;
			}
			case 'copy': {
				if (msg.value) {
					vscode.env.clipboard.writeText(msg.value);
				}
				break;
			}
			case 'reload': {
				void vscode.commands.executeCommand('flakeenv.reload');
				break;
			}
			case 'toggleAutoReload': {
				const config = vscode.workspace.getConfiguration('flakeenv');
				const current = config.get<boolean>('autoReload', true);
				void config.update('autoReload', !current, vscode.ConfigurationTarget.Global);
				this.panel.webview.postMessage({ type: 'autoReloadState', enabled: !current });
				break;
			}
		}
	}

	private dispose(): void {
		DashboardPanel.instance = undefined;
		this.panel.dispose();
		for (const d of this.disposables) {
			d.dispose();
		}
		this.disposables.length = 0;
	}
}
