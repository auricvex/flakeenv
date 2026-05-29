/**
 * Child process spawning for nix and direnv commands.
 */

import { spawn } from 'child_process';
import { isNixWarning } from './parsers';

export const DEFAULT_EXEC_TIMEOUT_MS = 120_000;
const MAX_BUFFER = 10 * 1024 * 1024;

export interface RunResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export function runCommand(
	bin: string,
	args: string[],
	opts: { cwd: string; env: NodeJS.ProcessEnv; timeout?: number },
): Promise<RunResult> {
	const timeout = opts.timeout ?? DEFAULT_EXEC_TIMEOUT_MS;

	return new Promise((resolve, reject) => {
		const child = spawn(bin, args, {
			cwd: opts.cwd,
			env: opts.env,
			stdio: ['ignore', 'pipe', 'pipe'],
			timeout,
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
				const errorLines = stderr
					.split('\n')
					.filter((l) => !isNixWarning(l) && l.trim().length > 0);
				const errorMsg =
					errorLines.length > 0
						? errorLines.join('\n').trim()
						: `\`${bin} ${args.join(' ')}\` exited with code ${exitCode}`;
				reject(new Error(errorMsg));
				return;
			}

			resolve({ stdout, stderr, exitCode });
		});
	});
}
