import { describe, it, expect } from 'vitest';
import { runCommand } from '../runner';

describe('runCommand', () => {
	it('captures stdout from a simple command', async () => {
		const result = await runCommand('echo', ['hello world'], {
			cwd: process.cwd(),
			env: process.env,
		});
		expect(result.stdout.trim()).toBe('hello world');
		expect(result.exitCode).toBe(0);
	});

	it('captures stderr', async () => {
		const result = await runCommand('sh', ['-c', 'echo error >&2'], {
			cwd: process.cwd(),
			env: process.env,
		});
		expect(result.stderr.trim()).toBe('error');
		expect(result.exitCode).toBe(0);
	});

	it('rejects on non-zero exit code', async () => {
		await expect(
			runCommand('sh', ['-c', 'exit 1'], {
				cwd: process.cwd(),
				env: process.env,
			}),
		).rejects.toThrow();
	});

	it('rejects on invalid binary', async () => {
		await expect(
			runCommand('/nonexistent/binary', [], {
				cwd: process.cwd(),
				env: process.env,
			}),
		).rejects.toThrow('Failed to start');
	});

	it('filters nix warnings from error messages', async () => {
		// A command that exits non-zero with a nix-style warning on stderr
		await expect(
			runCommand('sh', ['-c', 'echo "warning: something" >&2; echo "real error" >&2; exit 1'], {
				cwd: process.cwd(),
				env: process.env,
			}),
		).rejects.toThrow('real error');
	});
});
