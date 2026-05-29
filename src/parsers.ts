/**
 * Pure parsers for nix and direnv output.
 * No VS Code or Node.js dependencies beyond basic types.
 */

/** Nix warnings start with "warning:" — these should be logged but not treated as errors. */
export function isNixWarning(line: string): boolean {
	return /^\s*warning:/i.test(line);
}

/**
 * Parses the output of `env` (KEY=VALUE, one per logical line).
 * Handles multi-line values by detecting that continuation lines lack a
 * KEY= prefix.
 */
export function parseEnvOutput(raw: string): Record<string, string> {
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
export function parseNixPrintDevEnv(raw: string): Record<string, string> {
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
export function parseDirenvJson(raw: string): Record<string, string> {
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
