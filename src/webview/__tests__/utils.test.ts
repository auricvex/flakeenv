import { describe, it, expect } from 'vitest';
import {
	isPathLike,
	splitPathValue,
	maskValue,
	truncate,
	shellQuote,
	getCounts,
	getFilteredVars,
	getSourceLabel,
	getVarKey,
	isSkipped,
} from '../utils';
import type { EnvVariable, EnvironmentResult, SkippedVariable } from '../../environment';

const nixVar = (name: string, value: string): EnvVariable => ({
	name,
	value,
	source: 'nix',
});

const direnvVar = (name: string, value: string): EnvVariable => ({
	name,
	value,
	source: 'direnv',
});

const skippedVar = (name: string, value: string, reason: string): SkippedVariable => ({
	name,
	value,
	source: 'nix',
	reason,
});

describe('isSkipped', () => {
	it('returns true for skipped variables', () => {
		expect(isSkipped(skippedVar('HOME', '/home', 'blocked'))).toBe(true);
	});

	it('returns false for injected variables', () => {
		expect(isSkipped(nixVar('PATH', '/usr/bin'))).toBe(false);
	});
});

describe('getSourceLabel', () => {
	it('returns nix for nix variables', () => {
		expect(getSourceLabel(nixVar('PATH', '/usr/bin'))).toBe('nix');
	});

	it('returns direnv for direnv variables', () => {
		expect(getSourceLabel(direnvVar('FOO', 'bar'))).toBe('direnv');
	});

	it('returns skipped for skipped variables', () => {
		expect(getSourceLabel(skippedVar('HOME', '/home', 'blocked'))).toBe('skipped');
	});
});

describe('getVarKey', () => {
	it('generates unique keys for different sources', () => {
		const nix = nixVar('PATH', '/usr/bin');
		const direnv = direnvVar('PATH', '/usr/bin');
		expect(getVarKey(nix)).not.toBe(getVarKey(direnv));
	});

	it('generates consistent keys for same variable', () => {
		const v = nixVar('FOO', 'bar');
		expect(getVarKey(v)).toBe(getVarKey(v));
	});
});

describe('isPathLike', () => {
	it('recognizes PATH', () => {
		expect(isPathLike('PATH', '/usr/bin:/usr/local/bin')).toBe(true);
	});

	it('recognizes common path-like names', () => {
		expect(isPathLike('MANPATH', '/usr/share/man')).toBe(true);
		expect(isPathLike('PKG_CONFIG_PATH', '/usr/lib/pkgconfig')).toBe(true);
		expect(isPathLike('LD_LIBRARY_PATH', '/usr/lib')).toBe(true);
		expect(isPathLike('PYTHONPATH', '/usr/lib/python3')).toBe(true);
		expect(isPathLike('NODE_PATH', '/usr/lib/node_modules')).toBe(true);
	});

	it('recognizes _PATH and _DIRS suffixes with multiple entries', () => {
		expect(isPathLike('MY_CUSTOM_PATH', '/a:/b')).toBe(true);
		expect(isPathLike('MY_DIRS', '/a:/b')).toBe(true);
	});

	it('rejects non-path variables', () => {
		expect(isPathLike('HOME', '/home/user')).toBe(false);
		expect(isPathLike('EDITOR', 'vim')).toBe(false);
	});

	it('rejects empty name or value', () => {
		expect(isPathLike('', '/usr/bin')).toBe(false);
		expect(isPathLike('PATH', '')).toBe(false);
	});
});

describe('splitPathValue', () => {
	it('splits colon-delimited paths', () => {
		expect(splitPathValue('/usr/bin:/usr/local/bin')).toEqual(['/usr/bin', '/usr/local/bin']);
	});

	it('splits semicolon-delimited paths', () => {
		expect(splitPathValue('C:\\Users;D:\\Tools')).toEqual(['C:\\Users', 'D:\\Tools']);
	});

	it('filters empty segments', () => {
		expect(splitPathValue('/usr/bin::/usr/local/bin:')).toEqual(['/usr/bin', '/usr/local/bin']);
	});

	it('returns empty array for empty input', () => {
		expect(splitPathValue('')).toEqual([]);
	});
});

describe('maskValue', () => {
	it('masks values with asterisks', () => {
		const masked = maskValue('secret123');
		expect(masked).toMatch(/^\*+$/);
	});

	it('produces length between 8 and 32', () => {
		expect(maskValue('').length).toBe(8);
		expect(maskValue('a'.repeat(100)).length).toBe(32);
		expect(maskValue('abcdefgh').length).toBe(8);
	});
});

describe('truncate', () => {
	it('returns short values unchanged', () => {
		expect(truncate('hello', 10)).toBe('hello');
	});

	it('truncates long values', () => {
		expect(truncate('hello world', 5)).toBe('hello...');
	});

	it('handles empty string', () => {
		expect(truncate('', 10)).toBe('');
	});
});

describe('shellQuote', () => {
	it('wraps value in single quotes', () => {
		expect(shellQuote('hello')).toBe("'hello'");
	});

	it('handles single quotes in value', () => {
		expect(shellQuote("it's")).toBe("'it'\\''s'");
	});
});

describe('getCounts', () => {
	it('returns zeros for null data', () => {
		expect(getCounts(null)).toEqual({
			coverage: 0,
			direnv: 0,
			injected: 0,
			nix: 0,
			skipped: 0,
		});
	});

	it('counts correctly', () => {
		const data: EnvironmentResult = {
			injected: [nixVar('A', '1'), nixVar('B', '2'), direnvVar('C', '3')],
			skipped: [skippedVar('D', '4', 'blocked')],
			nixCount: 2,
			direnvCount: 1,
			status: 'ok',
			loadedAt: Date.now(),
		};
		const counts = getCounts(data);
		expect(counts.injected).toBe(3);
		expect(counts.nix).toBe(2);
		expect(counts.direnv).toBe(1);
		expect(counts.skipped).toBe(1);
		expect(counts.coverage).toBe(75); // 3/(3+1) = 75%
	});
});

describe('getFilteredVars', () => {
	const data: EnvironmentResult = {
		injected: [
			nixVar('PATH', '/usr/bin:/nix/store/bin'),
			nixVar('CARGO_HOME', '/home/user/.cargo'),
			direnvVar('DATABASE_URL', 'postgres://localhost'),
		],
		skipped: [skippedVar('HOME', '/home', 'blocked')],
		nixCount: 2,
		direnvCount: 1,
		status: 'ok',
		loadedAt: Date.now(),
	};

	it('returns all injected for "all" tab', () => {
		const vars = getFilteredVars(data, {
			tab: 'all',
			query: '',
			sort: 'name',
			dense: false,
			pathsOnly: false,
			masked: false,
			expanded: {},
		});
		expect(vars).toHaveLength(3);
	});

	it('filters by tab', () => {
		const nixVars = getFilteredVars(data, {
			tab: 'nix',
			query: '',
			sort: 'name',
			dense: false,
			pathsOnly: false,
			masked: false,
			expanded: {},
		});
		expect(nixVars).toHaveLength(2);

		const skippedVars = getFilteredVars(data, {
			tab: 'skipped',
			query: '',
			sort: 'name',
			dense: false,
			pathsOnly: false,
			masked: false,
			expanded: {},
		});
		expect(skippedVars).toHaveLength(1);
	});

	it('filters by query', () => {
		const vars = getFilteredVars(data, {
			tab: 'all',
			query: 'cargo',
			sort: 'name',
			dense: false,
			pathsOnly: false,
			masked: false,
			expanded: {},
		});
		expect(vars).toHaveLength(1);
		expect(vars[0].name).toBe('CARGO_HOME');
	});

	it('filters by pathsOnly', () => {
		const vars = getFilteredVars(data, {
			tab: 'all',
			query: '',
			sort: 'name',
			dense: false,
			pathsOnly: true,
			masked: false,
			expanded: {},
		});
		expect(vars).toHaveLength(1);
		expect(vars[0].name).toBe('PATH');
	});

	it('sorts by name', () => {
		const vars = getFilteredVars(data, {
			tab: 'all',
			query: '',
			sort: 'name',
			dense: false,
			pathsOnly: false,
			masked: false,
			expanded: {},
		});
		expect(vars.map((v) => v.name)).toEqual(['CARGO_HOME', 'DATABASE_URL', 'PATH']);
	});

	it('sorts by length', () => {
		const vars = getFilteredVars(data, {
			tab: 'all',
			query: '',
			sort: 'length',
			dense: false,
			pathsOnly: false,
			masked: false,
			expanded: {},
		});
		expect(vars[0].name).toBe('PATH'); // longest value
	});

	it('returns empty for null data', () => {
		const vars = getFilteredVars(null, {
			tab: 'all',
			query: '',
			sort: 'name',
			dense: false,
			pathsOnly: false,
			masked: false,
			expanded: {},
		});
		expect(vars).toEqual([]);
	});
});
