import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './tests',
	// Only *.spec.ts — leaves tests/unit/*.test.ts for vitest.
	testMatch: /.*\.spec\.ts$/,
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: 'html',
	use: {
		baseURL: 'http://localhost:4321',
		trace: 'on-first-retry',
	},
	projects: [
		{
			name: 'chromium',
			use: { browserName: 'chromium' },
		},
	],
	webServer: {
		// Not `astro dev`/`astro preview`: both daemonise and return, which
		// Playwright reports as "webServer exited early". See the script.
		command: 'npm run build && node scripts/serve-dist.mjs',
		url: 'http://localhost:4321',
		reuseExistingServer: !process.env.CI,
		timeout: 60_000,
	},
});
