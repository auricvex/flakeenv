import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { findBinary, enrichPath, NIX_SEARCH_PATHS, DIRENV_SEARCH_PATHS } from './binary';
import { parseNixPrintDevEnv, parseDirenvJson } from './parsers';
import { shouldSkipVar, getSkipReason, diffEnv, snapshotProcessEnv } from './filtering';
import { runCommand } from './runner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnvVariable {
	name: string;
	value: string;
	source: 'nix' | 'direnv';
}

export interface SkippedVariable {
	name: string;
	value: string;
	source: 'nix' | 'direnv';
	reason: string;
}

export interface EnvironmentChange {
	added: string[];
	removed: string[];
	changed: string[];
}

export interface EnvironmentResult {
	injected: EnvVariable[];
	skipped: SkippedVariable[];
	nixCount: number;
	direnvCount: number;
	status: 'ok' | 'error' | 'empty';
	errorMessage?: string;
	loadedAt: number;
	changes?: EnvironmentChange;
}

// ---------------------------------------------------------------------------
// Module state — holds the last loaded result so the dashboard can access it
// ---------------------------------------------------------------------------

let lastResult: EnvironmentResult | null = null;
const changeListeners: Array<(result: EnvironmentResult) => void> = [];
const hostBaselineEnv = snapshotProcessEnv();
let processInjectedKeys = new Set<string>();

export function getLastResult(): EnvironmentResult | null {
	return lastResult;
}

export function onEnvironmentChange(
	listener: (result: EnvironmentResult) => void,
): vscode.Disposable {
	changeListeners.push(listener);
	return new vscode.Disposable(() => {
		const idx = changeListeners.indexOf(listener);
		if (idx >= 0) {
			changeListeners.splice(idx, 1);
		}
	});
}

function notifyListeners(result: EnvironmentResult) {
	for (const listener of changeListeners) {
		listener(result);
	}
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

export interface LoadConfig {
	additionalBlockedVars?: string[];
	additionalBlockedPrefixes?: string[];
	execTimeoutMs?: number;
}

export async function loadEnvironment(
	context: vscode.ExtensionContext,
	log: (msg: string) => void,
	config?: LoadConfig,
): Promise<EnvironmentResult> {
	const envCollection = context.environmentVariableCollection;
	restoreInjectedProcessEnv();
	envCollection.clear();

	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		log('No workspace folder open — skipping.');
		const result: EnvironmentResult = {
			injected: [],
			skipped: [],
			nixCount: 0,
			direnvCount: 0,
			status: 'empty',
			loadedAt: Date.now(),
		};
		lastResult = result;
		notifyListeners(result);
		return result;
	}

	const root = workspaceFolder.uri.fsPath;
	const hasFlake = fs.existsSync(path.join(root, 'flake.nix'));
	const hasEnvrc = fs.existsSync(path.join(root, '.envrc'));

	if (!hasFlake && !hasEnvrc) {
		log('No flake.nix or .envrc found — nothing to do.');
		const result: EnvironmentResult = {
			injected: [],
			skipped: [],
			nixCount: 0,
			direnvCount: 0,
			status: 'empty',
			loadedAt: Date.now(),
		};
		lastResult = result;
		notifyListeners(result);
		return result;
	}

	const baseline = hostBaselineEnv;
	const blockedVars = new Set(config?.additionalBlockedVars ?? []);
	const blockedPrefixes = config?.additionalBlockedPrefixes ?? [];
	const execTimeout = config?.execTimeoutMs;

	const collectedEnv: Record<string, string> = {};
	const nixSourcedKeys = new Set<string>();
	const direnvSourcedKeys = new Set<string>();
	let nixVarCount = 0;
	let direnvVarCount = 0;

	try {
		// ── Step 1: flake.nix → nix print-dev-env ────────────────────
		if (hasFlake) {
			const nixBin = findBinary('nix', NIX_SEARCH_PATHS, log);
			if (!nixBin) {
				log('⚠ nix binary not found in PATH or common locations. Skipping flake.nix.');
				log('  Searched: PATH, ' + NIX_SEARCH_PATHS.join(', '));
				vscode.window.showWarningMessage(
					'FlakeEnv: `nix` not found. Install Nix or ensure it is in your PATH.',
				);
			} else {
				log(`flake.nix detected — running \`${nixBin} print-dev-env . --json\` …`);

				const result = await runCommand(nixBin, ['print-dev-env', '.', '--json'], {
					cwd: root,
					env: { ...hostBaselineEnv, ...enrichPath(NIX_SEARCH_PATHS) },
					timeout: execTimeout,
				});

				if (result.stderr.trim()) {
					for (const line of result.stderr.trim().split('\n')) {
						log(`  nix stderr: ${line}`);
					}
				}

				const nixVars = parseNixPrintDevEnv(result.stdout);
				const nixDiff = diffEnv(baseline, nixVars);
				nixVarCount = Object.keys(nixDiff).length;
				log(`nix print-dev-env produced ${nixVarCount} new/changed vars.`);
				Object.assign(collectedEnv, nixDiff);
				for (const key of Object.keys(nixDiff)) {
					nixSourcedKeys.add(key);
				}
			}
		}

		// ── Step 2: .envrc → direnv export json ──────────────────────
		if (hasEnvrc) {
			const direnvBin = findBinary('direnv', DIRENV_SEARCH_PATHS, log);
			if (!direnvBin) {
				log('⚠ direnv binary not found in PATH or common locations. Skipping .envrc.');
				log('  Searched: PATH, ' + DIRENV_SEARCH_PATHS.join(', '));
				if (!hasFlake) {
					vscode.window.showWarningMessage(
						'FlakeEnv: `direnv` not found. Install direnv or ensure it is in your PATH.',
					);
				}
			} else {
				log(`\\.envrc detected — running \`${direnvBin} export json\` …`);

				// Merge nix vars but preserve real HOME/USER/SHELL — nix print-dev-env
				// sets HOME=/homeless-shelter (sandbox convention) which breaks direnv.
				const direnvBase = {
					...hostBaselineEnv,
					...enrichPath(DIRENV_SEARCH_PATHS),
					...collectedEnv,
					// Restore real system values that nix sandbox overrides
					HOME: hostBaselineEnv.HOME ?? '',
					USER: hostBaselineEnv.USER ?? '',
					SHELL: hostBaselineEnv.SHELL ?? '',
				};
				try {
					const result = await runCommand(direnvBin, ['export', 'json'], {
						cwd: root,
						env: direnvBase,
						timeout: execTimeout,
					});

					if (result.stderr.trim()) {
						for (const line of result.stderr.trim().split('\n')) {
							log(`  direnv stderr: ${line}`);
						}
					}

					const direnvEnv = parseDirenvJson(result.stdout);
					direnvVarCount = Object.keys(direnvEnv).length;
					log(`direnv exported ${direnvVarCount} vars.`);
					Object.assign(collectedEnv, direnvEnv);
					for (const key of Object.keys(direnvEnv)) {
						direnvSourcedKeys.add(key);
					}
				} catch (direnvErr) {
					const errMsg = direnvErr instanceof Error ? direnvErr.message : String(direnvErr);
					if (errMsg.includes('is blocked')) {
						log('⚠ .envrc is blocked by direnv. User needs to run `direnv allow`.');
						const action = await vscode.window.showWarningMessage(
							'FlakeEnv: `.envrc` is blocked by direnv.',
							'Run direnv allow',
							'Dismiss',
						);
						if (action === 'Run direnv allow') {
							await runCommand(direnvBin, ['allow'], {
								cwd: root,
								env: direnvBase,
								timeout: execTimeout,
							});
							log('direnv allow succeeded — reload to pick up direnv vars.');
							vscode.window.showInformationMessage(
								'FlakeEnv: direnv allowed. Reloading environment…',
							);
							// Re-run the full load to pick up direnv vars
							return loadEnvironment(context, log, config);
						}
					} else {
						log(`⚠ direnv failed: ${errMsg}`);
					}
				}
			}
		}

		// ── Step 3: inject into VS Code ──────────────────────────────
		const injected: EnvVariable[] = [];
		const skipped: SkippedVariable[] = [];

		for (const [key, value] of Object.entries(collectedEnv)) {
			const source = direnvSourcedKeys.has(key) ? ('direnv' as const) : ('nix' as const);
			if (shouldSkipVar(key, blockedVars, blockedPrefixes)) {
				skipped.push({
					name: key,
					value,
					source,
					reason: getSkipReason(key, blockedVars, blockedPrefixes),
				});
				continue;
			}

			if (key === 'PATH') {
				// Prepend only new PATH entries so user tools (starship, direnv, etc.)
				// remain accessible. Nix paths get priority by being first.
				const basePath = hostBaselineEnv.PATH ?? '';
				const currentPath = new Set(basePath.split(path.delimiter));
				const newDirs = value.split(path.delimiter).filter((d) => d && !currentPath.has(d));
				if (newDirs.length > 0) {
					const prependValue = newDirs.join(path.delimiter) + path.delimiter;
					envCollection.prepend('PATH', prependValue);
					// Update process.env so language servers in the current
					// extension host inherit the new PATH immediately.
					process.env.PATH = prependValue + basePath;
					processInjectedKeys.add(key);
					injected.push({ name: key, value: prependValue, source });
				}
			} else {
				envCollection.replace(key, value);
				// Update process.env for immediate availability to other extensions.
				process.env[key] = value;
				processInjectedKeys.add(key);
				injected.push({ name: key, value, source });
			}
		}

		if (skipped.length > 0) {
			log(`Filtered out ${skipped.length} blocked vars: ${skipped.map((s) => s.name).join(', ')}`);
		}

		log(`✓ Injected ${injected.length} vars into VS Code environment.`);

		const changes = computeChanges(lastResult, injected);
		if (changes.added.length > 0 || changes.removed.length > 0 || changes.changed.length > 0) {
			log(
				`  Changes: +${changes.added.length} added, -${changes.removed.length} removed, ~${changes.changed.length} changed`,
			);
		}

		const envResult: EnvironmentResult = {
			injected,
			skipped,
			nixCount: nixVarCount,
			direnvCount: direnvVarCount,
			status: 'ok',
			loadedAt: Date.now(),
			changes,
		};
		lastResult = envResult;
		notifyListeners(envResult);
		return envResult;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		log(`✗ Error: ${msg}`);
		const envResult: EnvironmentResult = {
			injected: [],
			skipped: [],
			nixCount: nixVarCount,
			direnvCount: direnvVarCount,
			status: 'error',
			errorMessage: msg,
			loadedAt: Date.now(),
		};
		lastResult = envResult;
		notifyListeners(envResult);
		return envResult;
	}
}

// ---------------------------------------------------------------------------
// Change diff
// ---------------------------------------------------------------------------

function computeChanges(
	previous: EnvironmentResult | null,
	currentInjected: EnvVariable[],
): EnvironmentChange {
	if (!previous || previous.status !== 'ok') {
		return { added: currentInjected.map((v) => v.name), removed: [], changed: [] };
	}

	const prevMap = new Map(previous.injected.map((v) => [v.name, v.value]));
	const currMap = new Map(currentInjected.map((v) => [v.name, v.value]));

	const added: string[] = [];
	const removed: string[] = [];
	const changed: string[] = [];

	for (const name of currMap.keys()) {
		if (!prevMap.has(name)) {
			added.push(name);
		} else if (prevMap.get(name) !== currMap.get(name)) {
			changed.push(name);
		}
	}

	for (const name of prevMap.keys()) {
		if (!currMap.has(name)) {
			removed.push(name);
		}
	}

	return { added, removed, changed };
}

// ---------------------------------------------------------------------------
// Process env management
// ---------------------------------------------------------------------------

function restoreInjectedProcessEnv(): void {
	for (const key of processInjectedKeys) {
		const value = hostBaselineEnv[key];
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
	processInjectedKeys = new Set<string>();
}
