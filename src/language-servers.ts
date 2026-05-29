import * as vscode from 'vscode';

export interface LanguageServer {
	extensionId: string;
	command: string;
	name: string;
}

/** Default language servers to restart after environment injection. */
export const DEFAULT_LANGUAGE_SERVERS: readonly LanguageServer[] = [
	{
		extensionId: 'rust-lang.rust-analyzer',
		command: 'rust-analyzer.restartServer',
		name: 'rust-analyzer',
	},
	{
		extensionId: 'vadimcn.vscode-lldb',
		command: 'lldb.restart',
		name: 'CodeLLDB',
	},
];

export function getLanguageServers(userServers: LanguageServer[] = []): LanguageServer[] {
	return [...DEFAULT_LANGUAGE_SERVERS, ...userServers];
}

export async function restartLanguageServers(
	servers: readonly LanguageServer[],
	log: (msg: string) => void,
): Promise<void> {
	// Brief delay to let language servers finish their initial (failed) startup
	// before we ask them to restart with the corrected environment.
	await new Promise((resolve) => setTimeout(resolve, 1500));

	for (const { extensionId, command, name } of servers) {
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
