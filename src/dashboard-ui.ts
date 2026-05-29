import * as vscode from 'vscode';
import css from './webview/dashboard.css';

export function getDashboardUi(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
	nonce: string,
): string {
	const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'dashboard.js'));

	return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta http-equiv="Content-Security-Policy"
		content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
	<title>FlakeEnv Dashboard</title>
	<style nonce="${nonce}">
		${css}
	</style>
</head>
<body>
	<div id="root"></div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
