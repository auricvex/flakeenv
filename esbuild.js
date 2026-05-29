const esbuild = require("esbuild");
const fs = require("fs");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	if (production) {
		for (const file of ['dist/extension.js.map', 'dist/dashboard.js.map']) {
			fs.rmSync(file, { force: true });
		}
	}

	const contexts = await Promise.all([
		esbuild.context({
			entryPoints: [
				'src/extension.ts'
			],
			bundle: true,
			format: 'cjs',
			minify: production,
			sourcemap: !production,
			sourcesContent: false,
			platform: 'node',
			outfile: 'dist/extension.js',
			external: ['vscode'],
			loader: {
				'.css': 'text',
			},
			logLevel: 'silent',
			plugins: [
				esbuildProblemMatcherPlugin,
			],
		}),
		esbuild.context({
			entryPoints: [
				'src/webview/index.tsx'
			],
			bundle: true,
			format: 'iife',
			minify: production,
			sourcemap: !production,
			sourcesContent: false,
			platform: 'browser',
			target: 'es2022',
			outfile: 'dist/dashboard.js',
			define: {
				'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development'),
			},
			loader: {
				'.css': 'text',
			},
			logLevel: 'silent',
			plugins: [
				esbuildProblemMatcherPlugin,
			],
		}),
	]);

	if (watch) {
		await Promise.all(contexts.map(ctx => ctx.watch()));
	} else {
		await Promise.all(contexts.map(ctx => ctx.rebuild()));
		await Promise.all(contexts.map(ctx => ctx.dispose()));
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});