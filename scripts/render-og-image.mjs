import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const width = 1200;
const height = 630;
const templatePath = resolve(root, 'src/assets/social/og-image.html');
const outputPath = resolve(root, 'public/img/og-image.png');

let html = await readFile(templatePath, 'utf8');
const mark = (await readFile(resolve(root, 'src/assets/nd-monogram.svg'), 'utf8'))
	.replace('<svg ', '<svg class="mark" ');

// Inline the SVG so the colour variables in .mark apply to it.
html = html.replace(/<img class="mark"[^>]*>/, mark);

const bundledBrowserAvailable = await access(chromium.executablePath())
	.then(() => true)
	.catch(() => false);
const browser = await chromium.launch(
	bundledBrowserAvailable ? { headless: true } : { channel: 'chrome', headless: true },
);

try {
	const page = await browser.newPage({
		viewport: { width, height },
		deviceScaleFactor: 1,
	});
	await page.setContent(html, { waitUntil: 'networkidle' });
	await page.evaluate(async () => {
		await document.fonts.ready;
		for (const weight of [400, 600, 700]) {
			if (!document.fonts.check(`${weight} 16px "Fira Sans"`)) {
				throw new Error(`Fira Sans ${weight} failed to load.`);
			}
		}
	});
	await page.screenshot({ path: outputPath, type: 'png' });
} finally {
	await browser.close();
}
