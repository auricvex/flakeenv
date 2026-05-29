import { describe, it, expect } from 'vitest';
import { shouldSkipVar, getSkipReason, diffEnv, BLOCKED_VARS } from '../filtering';

describe('shouldSkipVar', () => {
	it('blocks variables in BLOCKED_VARS', () => {
		for (const name of BLOCKED_VARS) {
			expect(shouldSkipVar(name)).toBe(true);
		}
	});

	it('blocks variables with blocked prefixes', () => {
		expect(shouldSkipVar('__NIX_DARWIN_SET_ENVIRONMENT_DONE')).toBe(true);
		expect(shouldSkipVar('NIX_BUILD_CORES')).toBe(true);
		expect(shouldSkipVar('IN_NIX_SHELL')).toBe(true);
		expect(shouldSkipVar('VSCODE_GIT_IPC_HANDLE')).toBe(true);
	});

	it('allows normal variables', () => {
		expect(shouldSkipVar('PATH')).toBe(false);
		expect(shouldSkipVar('CARGO_HOME')).toBe(false);
		expect(shouldSkipVar('RUSTUP_HOME')).toBe(false);
		expect(shouldSkipVar('PKG_CONFIG_PATH')).toBe(false);
	});

	it('respects additional blocked vars', () => {
		const extra = new Set(['MY_CUSTOM_VAR']);
		expect(shouldSkipVar('MY_CUSTOM_VAR', extra)).toBe(true);
		expect(shouldSkipVar('PATH', extra)).toBe(false);
	});

	it('respects additional blocked prefixes', () => {
		expect(shouldSkipVar('MYAPP_SECRET_KEY', new Set(), ['MYAPP_'])).toBe(true);
		expect(shouldSkipVar('PATH', new Set(), ['MYAPP_'])).toBe(false);
	});
});

describe('getSkipReason', () => {
	it('returns correct reason for blocked vars', () => {
		expect(getSkipReason('HOME')).toBe('Blocked variable (VS Code / shell internal)');
		expect(getSkipReason('VSCODE_GIT_IPC_HANDLE')).toBe(
			'Blocked variable (VS Code / shell internal)',
		);
	});

	it('returns correct reason for blocked prefixes', () => {
		expect(getSkipReason('__NIX_SOME_VAR')).toBe('Blocked prefix: __*');
		expect(getSkipReason('NIX_BUILD_CORES')).toBe('Blocked prefix: NIX_BUILD_*');
		expect(getSkipReason('IN_NIX_SHELL')).toBe('Blocked prefix: IN_NIX_SHELL*');
		expect(getSkipReason('VSCODE_SOME_SETTING')).toBe('Blocked prefix: VSCODE_*');
	});

	it('returns Unknown for unrecognized vars', () => {
		expect(getSkipReason('SOME_RANDOM_VAR')).toBe('Unknown');
	});
});

describe('diffEnv', () => {
	it('detects added variables', () => {
		const before = { A: '1' };
		const after = { A: '1', B: '2' };
		expect(diffEnv(before, after)).toEqual({ B: '2' });
	});

	it('detects changed variables', () => {
		const before = { A: '1' };
		const after = { A: 'changed' };
		expect(diffEnv(before, after)).toEqual({ A: 'changed' });
	});

	it('ignores removed variables', () => {
		const before = { A: '1', B: '2' };
		const after = { A: '1' };
		expect(diffEnv(before, after)).toEqual({});
	});

	it('ignores unchanged variables', () => {
		const before = { A: '1', B: '2' };
		const after = { A: '1', B: '2' };
		expect(diffEnv(before, after)).toEqual({});
	});

	it('handles empty objects', () => {
		expect(diffEnv({}, {})).toEqual({});
		expect(diffEnv({}, { A: '1' })).toEqual({ A: '1' });
		expect(diffEnv({ A: '1' }, {})).toEqual({});
	});
});
