/**
 * Variable filtering logic — decides which env vars to skip.
 */

/** Vars that should never be injected — VS Code / Electron internals. */
export const BLOCKED_VARS = new Set([
	'_',
	'HOME',
	'USER',
	'LOGNAME',
	'SHLVL',
	'PWD',
	'OLDPWD',
	'TEMP',
	'TMPDIR',
	'TMP',
	'TERM',
	'TERM_PROGRAM',
	'TERM_PROGRAM_VERSION',
	'TERM_SESSION_ID',
	'SHELL',
	'COLORTERM',
	'GIT_ASKPASS',
	'VSCODE_GIT_ASKPASS_NODE',
	'VSCODE_GIT_ASKPASS_EXTRA_ARGS',
	'VSCODE_GIT_ASKPASS_MAIN',
	'VSCODE_GIT_IPC_HANDLE',
	'VSCODE_INJECTION',
	'ELECTRON_RUN_AS_NODE',
	'VSCODE_IPC_HOOK',
	'APPLICATION_INSIGHTS_NO_DIAGNOSTIC_CHANNEL',
]);

/** Prefixes that mark transient nix-build internals or VS Code internals. */
export const BLOCKED_PREFIXES = ['__', 'NIX_BUILD_', 'IN_NIX_SHELL', 'VSCODE_'];

export function shouldSkipVar(
	key: string,
	additionalBlockedVars: Set<string> = new Set(),
	additionalBlockedPrefixes: string[] = [],
): boolean {
	if (BLOCKED_VARS.has(key) || additionalBlockedVars.has(key)) {
		return true;
	}
	for (const prefix of [...BLOCKED_PREFIXES, ...additionalBlockedPrefixes]) {
		if (key.startsWith(prefix)) {
			return true;
		}
	}
	return false;
}

export function getSkipReason(
	key: string,
	additionalBlockedVars: Set<string> = new Set(),
	additionalBlockedPrefixes: string[] = [],
): string {
	if (BLOCKED_VARS.has(key) || additionalBlockedVars.has(key)) {
		return 'Blocked variable (VS Code / shell internal)';
	}
	for (const prefix of [...BLOCKED_PREFIXES, ...additionalBlockedPrefixes]) {
		if (key.startsWith(prefix)) {
			return `Blocked prefix: ${prefix}*`;
		}
	}
	return 'Unknown';
}

export function diffEnv(
	before: Record<string, string>,
	after: Record<string, string>,
): Record<string, string> {
	const diff: Record<string, string> = {};
	for (const [key, value] of Object.entries(after)) {
		if (before[key] !== value) {
			diff[key] = value;
		}
	}
	return diff;
}

/** Snapshot current process.env as a plain Record (dropping undefineds). */
export function snapshotProcessEnv(): Record<string, string> {
	const snap: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined) {
			snap[key] = value;
		}
	}
	return snap;
}
