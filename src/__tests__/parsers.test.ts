import { describe, it, expect } from 'vitest';
import { parseNixPrintDevEnv, parseDirenvJson, parseEnvOutput, isNixWarning } from '../parsers';

describe('isNixWarning', () => {
	it('detects warning lines', () => {
		expect(isNixWarning('warning: something')).toBe(true);
		expect(isNixWarning('  warning: indented')).toBe(true);
		expect(isNixWarning('Warning: capital')).toBe(true);
		expect(isNixWarning('WARNING: all caps')).toBe(true);
	});

	it('rejects non-warning lines', () => {
		expect(isNixWarning('error: something')).toBe(false);
		expect(isNixWarning('this is not a warning')).toBe(false);
		expect(isNixWarning('')).toBe(false);
	});
});

describe('parseNixPrintDevEnv', () => {
	it('parses exported variables', () => {
		const input = JSON.stringify({
			variables: {
				PATH: { type: 'exported', value: '/nix/store/bin' },
				HOME: { type: 'exported', value: '/homeless-shelter' },
			},
		});
		const result = parseNixPrintDevEnv(input);
		expect(result).toEqual({
			PATH: '/nix/store/bin',
			HOME: '/homeless-shelter',
		});
	});

	it('skips non-exported variables', () => {
		const input = JSON.stringify({
			variables: {
				PATH: { type: 'exported', value: '/nix/store/bin' },
				INTERNAL: { type: 'var', value: 'should-be-skipped' },
				ARRAY_VAR: { type: 'array', value: ['a', 'b'] },
			},
		});
		const result = parseNixPrintDevEnv(input);
		expect(result).toEqual({ PATH: '/nix/store/bin' });
	});

	it('returns empty object for empty input', () => {
		expect(parseNixPrintDevEnv('')).toEqual({});
		expect(parseNixPrintDevEnv('  ')).toEqual({});
	});

	it('throws on invalid JSON', () => {
		expect(() => parseNixPrintDevEnv('not json')).toThrow(
			'Failed to parse nix print-dev-env JSON output',
		);
	});

	it('handles missing variables key', () => {
		const result = parseNixPrintDevEnv(JSON.stringify({}));
		expect(result).toEqual({});
	});
});

describe('parseDirenvJson', () => {
	it('parses key-value pairs', () => {
		const input = JSON.stringify({ FOO: 'bar', BAZ: 'qux' });
		const result = parseDirenvJson(input);
		expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
	});

	it('skips null values (unset vars)', () => {
		const input = JSON.stringify({ FOO: 'bar', REMOVED: null });
		const result = parseDirenvJson(input);
		expect(result).toEqual({ FOO: 'bar' });
	});

	it('returns empty object for empty input', () => {
		expect(parseDirenvJson('')).toEqual({});
		expect(parseDirenvJson('  ')).toEqual({});
	});

	it('throws on invalid JSON', () => {
		expect(() => parseDirenvJson('not json')).toThrow('Failed to parse direnv JSON output');
	});
});

describe('parseEnvOutput', () => {
	it('parses simple key-value pairs', () => {
		const input = 'FOO=bar\nBAZ=qux';
		const result = parseEnvOutput(input);
		expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
	});

	it('handles multi-line values', () => {
		const input = 'FOO=line1\nline2\nline3\nBAR=simple';
		const result = parseEnvOutput(input);
		expect(result).toEqual({ FOO: 'line1\nline2\nline3', BAR: 'simple' });
	});

	it('handles empty values', () => {
		const input = 'EMPTY=\nHAS_VALUE=yes';
		const result = parseEnvOutput(input);
		expect(result).toEqual({ EMPTY: '', HAS_VALUE: 'yes' });
	});

	it('handles values with equals signs', () => {
		const input = 'EQUATION=a=b+c';
		const result = parseEnvOutput(input);
		expect(result).toEqual({ EQUATION: 'a=b+c' });
	});

	it('returns empty object for empty input', () => {
		expect(parseEnvOutput('')).toEqual({});
	});

	it('handles underscore-prefixed keys', () => {
		const input = '__NIX_DARWIN_SET_ENVIRONMENT_DONE=1';
		const result = parseEnvOutput(input);
		expect(result).toEqual({ __NIX_DARWIN_SET_ENVIRONMENT_DONE: '1' });
	});
});
