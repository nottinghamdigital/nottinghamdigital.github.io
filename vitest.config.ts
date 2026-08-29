import { defineConfig } from 'vitest/config';

// Kept narrow so vitest can't grab Playwright's *.spec.ts files, which import
// `test` from @playwright/test and would fail here.
export default defineConfig({
	test: {
		include: ['tests/unit/**/*.test.ts'],
	},
});
