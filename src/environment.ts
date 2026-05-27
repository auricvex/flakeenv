import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { findBinary, enrichPath, NIX_SEARCH_PATHS, DIRENV_SEARCH_PATHS } from './binary';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXEC_TIMEOUT_MS = 120_000;
const MAX_BUFFER = 10 * 1024 * 1024;

/** Vars that should never be injected — VS Code / Electron internals. */
const BLOCKED_VARS = new Set([
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
const BLOCKED_PREFIXES = [
    '__',
    'NIX_BUILD_',
    'IN_NIX_SHELL',
    'VSCODE_',
];

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

export interface EnvironmentResult {
    injected: EnvVariable[];
    skipped: SkippedVariable[];
    nixCount: number;
    direnvCount: number;
    status: 'ok' | 'error' | 'empty';
    errorMessage?: string;
    loadedAt: number;
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

export function onEnvironmentChange(listener: (result: EnvironmentResult) => void): vscode.Disposable {
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

export async function loadEnvironment(
    context: vscode.ExtensionContext,
    log: (msg: string) => void,
): Promise<EnvironmentResult> {
    const envCollection = context.environmentVariableCollection;
    restoreInjectedProcessEnv();
    envCollection.clear();

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        log('No workspace folder open — skipping.');
        const result: EnvironmentResult = {
            injected: [], skipped: [], nixCount: 0, direnvCount: 0,
            status: 'empty', loadedAt: Date.now(),
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
            injected: [], skipped: [], nixCount: 0, direnvCount: 0,
            status: 'empty', loadedAt: Date.now(),
        };
        lastResult = result;
        notifyListeners(result);
        return result;
    }

    const baseline = hostBaselineEnv;

    let collectedEnv: Record<string, string> = {};
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
                    'FlakeEnv: `nix` not found. Install Nix or ensure it is in your PATH.'
                );
            } else {
                log(`flake.nix detected — running \`${nixBin} print-dev-env . --json\` …`);

                const result = await runCommand(nixBin, ['print-dev-env', '.', '--json'], {
                    cwd: root,
                    env: { ...hostBaselineEnv, ...enrichPath(NIX_SEARCH_PATHS) },
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
                        'FlakeEnv: `direnv` not found. Install direnv or ensure it is in your PATH.'
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
                            await runCommand(direnvBin, ['allow'], { cwd: root, env: direnvBase });
                            log('direnv allow succeeded — reload to pick up direnv vars.');
                            vscode.window.showInformationMessage('FlakeEnv: direnv allowed. Reloading environment…');
                            // Re-run the full load to pick up direnv vars
                            return loadEnvironment(context, log);
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
            const source = direnvSourcedKeys.has(key) ? 'direnv' as const : 'nix' as const;
            if (shouldSkipVar(key)) {
                skipped.push({ name: key, value, source, reason: getSkipReason(key) });
                continue;
            }

            if (key === 'PATH') {
                // Prepend only new PATH entries so user tools (starship, direnv, etc.)
                // remain accessible. Nix paths get priority by being first.
                const basePath = hostBaselineEnv.PATH ?? '';
                const currentPath = new Set(basePath.split(path.delimiter));
                const newDirs = value.split(path.delimiter).filter(d => d && !currentPath.has(d));
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
            log(`Filtered out ${skipped.length} blocked vars: ${skipped.map(s => s.name).join(', ')}`);
        }

        log(`✓ Injected ${injected.length} vars into VS Code environment.`);

        const envResult: EnvironmentResult = {
            injected,
            skipped,
            nixCount: nixVarCount,
            direnvCount: direnvVarCount,
            status: 'ok',
            loadedAt: Date.now(),
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
// Command runner — uses spawn to properly separate stdout / stderr
// ---------------------------------------------------------------------------

interface RunResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

function runCommand(
    bin: string,
    args: string[],
    opts: { cwd: string; env: NodeJS.ProcessEnv }
): Promise<RunResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(bin, args, {
            cwd: opts.cwd,
            env: opts.env,
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: EXEC_TIMEOUT_MS,
        });

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let stdoutLen = 0;
        let stderrLen = 0;

        child.stdout.on('data', (chunk: Buffer) => {
            stdoutLen += chunk.length;
            if (stdoutLen <= MAX_BUFFER) {
                stdoutChunks.push(chunk);
            }
        });

        child.stderr.on('data', (chunk: Buffer) => {
            stderrLen += chunk.length;
            if (stderrLen <= MAX_BUFFER) {
                stderrChunks.push(chunk);
            }
        });

        child.on('error', (err) => {
            reject(new Error(`Failed to start \`${bin}\`: ${err.message}`));
        });

        child.on('close', (code) => {
            const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
            const stderr = Buffer.concat(stderrChunks).toString('utf-8');
            const exitCode = code ?? 1;

            if (exitCode !== 0) {
                const errorLines = stderr.split('\n').filter(l => !isNixWarning(l) && l.trim().length > 0);
                const errorMsg = errorLines.length > 0
                    ? errorLines.join('\n').trim()
                    : `\`${bin} ${args.join(' ')}\` exited with code ${exitCode}`;
                reject(new Error(errorMsg));
                return;
            }

            resolve({ stdout, stderr, exitCode });
        });
    });
}

/** Nix warnings start with "warning:" — these should be logged but not treated as errors. */
function isNixWarning(line: string): boolean {
    return /^\s*warning:/i.test(line);
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * Parses the output of `env` (KEY=VALUE, one per logical line).
 * Handles multi-line values by detecting that continuation lines lack a
 * KEY= prefix.
 */
function parseEnvOutput(raw: string): Record<string, string> {
    const result: Record<string, string> = {};
    const lines = raw.split('\n');

    let currentKey: string | null = null;
    let currentValue: string[] = [];

    for (const line of lines) {
        const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)/);
        if (match) {
            if (currentKey !== null) {
                result[currentKey] = currentValue.join('\n');
            }
            currentKey = match[1];
            currentValue = [match[2]];
        } else if (currentKey !== null) {
            currentValue.push(line);
        }
    }
    if (currentKey !== null) {
        result[currentKey] = currentValue.join('\n');
    }

    return result;
}

/**
 * Parses `nix print-dev-env --json` output.
 * The JSON has a `variables` key containing objects with `type` and `value`.
 * We only care about `type: "exported"` variables (actual env vars).
 */
function parseNixPrintDevEnv(raw: string): Record<string, string> {
    const trimmed = raw.trim();
    if (!trimmed) {
        return {};
    }

    try {
        const parsed = JSON.parse(trimmed) as {
            variables?: Record<string, { type: string; value: string }>;
        };
        const result: Record<string, string> = {};
        const vars = parsed.variables ?? {};
        for (const [key, info] of Object.entries(vars)) {
            // Only inject exported variables — skip internal "var" and "array" types
            if (info.type === 'exported' && typeof info.value === 'string') {
                result[key] = info.value;
            }
        }
        return result;
    } catch {
        throw new Error('Failed to parse nix print-dev-env JSON output');
    }
}

/**
 * Parses `direnv export json` output. direnv already outputs only the diff.
 * Null values mean "unset this var" — we skip those.
 */
function parseDirenvJson(raw: string): Record<string, string> {
    const trimmed = raw.trim();
    if (!trimmed) {
        return {};
    }

    try {
        const parsed = JSON.parse(trimmed) as Record<string, string | null>;
        const result: Record<string, string> = {};
        for (const [key, value] of Object.entries(parsed)) {
            if (value !== null) {
                result[key] = value;
            }
        }
        return result;
    } catch {
        throw new Error('Failed to parse direnv JSON output');
    }
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

function diffEnv(before: Record<string, string>, after: Record<string, string>): Record<string, string> {
    const diff: Record<string, string> = {};
    for (const [key, value] of Object.entries(after)) {
        if (before[key] !== value) {
            diff[key] = value;
        }
    }
    return diff;
}

function shouldSkipVar(key: string): boolean {
    if (BLOCKED_VARS.has(key)) {
        return true;
    }
    for (const prefix of BLOCKED_PREFIXES) {
        if (key.startsWith(prefix)) {
            return true;
        }
    }
    return false;
}

function getSkipReason(key: string): string {
    if (BLOCKED_VARS.has(key)) {
        return 'Blocked variable (VS Code / shell internal)';
    }
    for (const prefix of BLOCKED_PREFIXES) {
        if (key.startsWith(prefix)) {
            return `Blocked prefix: ${prefix}*`;
        }
    }
    return 'Unknown';
}

/** Snapshot current process.env as a plain Record (dropping undefineds). */
function snapshotProcessEnv(): Record<string, string> {
    const snap: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
            snap[key] = value;
        }
    }
    return snap;
}

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