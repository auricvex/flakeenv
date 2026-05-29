import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: 'extension',
					include: ['src/__tests__/**/*.test.ts'],
					environment: 'node',
				},
			},
			{
				test: {
					name: 'webview',
					include: ['src/webview/__tests__/**/*.test.ts'],
					environment: 'node',
				},
			},
		],
	},
});
