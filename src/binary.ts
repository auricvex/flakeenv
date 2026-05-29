import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Common locations where nix is installed on macOS / Linux. */
export const NIX_SEARCH_PATHS = [
	'/nix/var/nix/profiles/default/bin',
	path.join(os.homedir(), '.nix-profile/bin'),
	'/run/current-system/sw/bin',
];

/** Common locations where direnv may be installed. */
export const DIRENV_SEARCH_PATHS = [
	'/nix/var/nix/profiles/default/bin',
	path.join(os.homedir(), '.nix-profile/bin'),
	'/run/current-system/sw/bin',
	'/opt/homebrew/bin',
	'/usr/local/bin',
];

// ---------------------------------------------------------------------------
// Binary discovery
// ---------------------------------------------------------------------------

/**
 * Finds a binary by name. First checks process.env.PATH, then falls back to
 * well-known installation paths. This handles VS Code launched from Finder
 * where /nix/... paths are not in PATH.
 */
export function findBinary(
	name: string,
	extraPaths: string[],
	log?: (msg: string) => void,
): string | null {
	// 1. Check if it's directly available in current PATH
	const pathDirs = (process.env.PATH ?? '').split(path.delimiter);
	for (const dir of pathDirs) {
		const candidate = path.join(dir, name);
		if (isExecutable(candidate)) {
			return candidate;
		}
	}

	// 2. Check well-known locations
	for (const dir of extraPaths) {
		const candidate = path.join(dir, name);
		if (isExecutable(candidate)) {
			log?.(`Found \`${name}\` at ${candidate} (not in PATH, using well-known location)`);
			return candidate;
		}
	}

	return null;
}

export function isExecutable(filePath: string): boolean {
	try {
		fs.accessSync(filePath, fs.constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * Returns a PATH env override that includes extra search paths.
 * This ensures child processes (like `nix develop`) can find tools.
 */
export function enrichPath(extraPaths: string[]): { PATH: string } {
	const currentPath = process.env.PATH ?? '';
	const extra = extraPaths.filter((p) => !currentPath.includes(p));
	return { PATH: [...extra, currentPath].join(path.delimiter) };
}
