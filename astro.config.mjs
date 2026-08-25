// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
	site: 'https://nottingham.digital',
	build: {
		// Emit `/about` as `/about.html` style URLs would break the apex domain
		// setup; keep the default directory format used by GitHub Pages.
		format: 'directory',
	},
});
