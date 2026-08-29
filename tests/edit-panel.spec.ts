import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

const REPO_MEETUPS_DIR = new URL(
	'../src/content/meetups/',
	import.meta.url,
);

async function loadMeetup(file: string) {
	return parse(
		await readFile(new URL(file, REPO_MEETUPS_DIR), 'utf-8'),
	) as {
		name: string;
		summary: string;
		cadence: string;
		category: string;
		url: string;
	};
}

// Rather than target "the first card", pick a specific one whose fields don't
// churn so the assertions can be exact. Nottingham Programmers has no `links`
// which means the links textarea is empty — one less moving part.
const FIXTURE_FILE = 'nottingham-programmers.yml';

// The pencil is hidden by default — "Show edit links" in the footer flips
// data-edit-mode on <html> via localStorage. Prime it here so the tests
// exercise the flow an organiser actually uses.
async function enableEditMode(page: import('@playwright/test').Page) {
	await page.addInitScript(() => {
		localStorage.setItem('nd-edit-mode', 'true');
	});
}

test.describe('Suggest-edit panel', () => {
	test('opens on click and pre-fills the fields from the meetup file', async ({
		page,
	}) => {
		const meetup = await loadMeetup(FIXTURE_FILE);
		await enableEditMode(page);
		await page.goto('/');

		const card = page.locator('.meetup-card').filter({
			has: page.locator(`.p-name`, { hasText: meetup.name }),
		});
		await expect(card).toHaveCount(1);

		const toggle = card.locator('[data-edit-toggle]');
		const panel = card.locator('[data-edit-panel]');

		await expect(panel).toBeHidden();
		await toggle.click();
		await expect(panel).toBeVisible();
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');

		await expect(panel.locator('[data-field="cadence"]')).toHaveValue(
			meetup.cadence,
		);
		await expect(panel.locator('[data-field="summary"]')).toHaveValue(
			meetup.summary,
		);
		// The <select>'s data-default-value carries the human-readable label so
		// the client script can compare it without knowing the id mapping.
		const categorySelect = panel.locator('[data-field="category"]');
		const defaultCategory = await categorySelect.getAttribute(
			'data-default-value',
		);
		await expect(categorySelect).toHaveValue(defaultCategory!);
	});

	test('Continue builds a GitHub URL with only the changed fields', async ({
		page,
	}) => {
		const meetup = await loadMeetup(FIXTURE_FILE);

		await enableEditMode(page);
		// Stub window.open before the page's own scripts run so the assertion
		// can inspect the URL without a real popup being blocked.
		await page.addInitScript(() => {
			(window as unknown as { __openedUrls: string[] }).__openedUrls = [];
			window.open = ((url?: string | URL) => {
				(window as unknown as { __openedUrls: string[] }).__openedUrls.push(
					String(url ?? ''),
				);
				return null;
			}) as typeof window.open;
		});

		await page.goto('/');
		const card = page.locator('.meetup-card').filter({
			has: page.locator(`.p-name`, { hasText: meetup.name }),
		});
		await card.locator('[data-edit-toggle]').click();

		const panel = card.locator('[data-edit-panel]');
		const newSummary = 'A rewritten summary for testing purposes only.';
		await panel.locator('[data-field="summary"]').fill(newSummary);
		// Category lives inside the collapsed "Advanced" <details>; open it
		// before Playwright's actionability check runs on the <select>.
		await panel.locator('.edit-panel__advanced summary').click();
		await panel
			.locator('[data-field="category"]')
			.selectOption({ label: 'Design' });

		await panel.locator('[data-edit-continue]').click();

		const openedUrls = await page.evaluate(
			() => (window as unknown as { __openedUrls: string[] }).__openedUrls,
		);
		expect(openedUrls).toHaveLength(1);

		const url = new URL(openedUrls[0]);
		expect(`${url.origin}${url.pathname}`).toBe(
			'https://github.com/nottinghamdigital/nottinghamdigital.github.io/issues/new',
		);
		expect(url.searchParams.get('template')).toBe('suggest-edit.yml');
		// Pins the "Fill in the issue title" regression: the title must carry
		// the group name so a maintainer can triage without opening the body.
		expect(url.searchParams.get('title')).toBe(
			`[Edit suggestion]: ${meetup.name}`,
		);
		expect(url.searchParams.get('group-name')).toBe(meetup.name);
		expect(url.searchParams.get('new-summary')).toBe(newSummary);
		expect(url.searchParams.get('new-category')).toBe('Design');

		// The "only changed fields" contract: untouched inputs must be absent
		// from the URL so the GitHub form treats them as no-change.
		for (const param of ['new-name', 'new-url', 'new-events', 'new-cadence', 'new-notes', 'new-links']) {
			expect(url.searchParams.has(param)).toBe(false);
		}
	});

	test.describe('without JS', () => {
		test.use({ javaScriptEnabled: false });

		test('the pencil is hidden and the panel never becomes visible — same PE contract as filters and theme toggle', async ({
			page,
		}) => {
			// The pencil ships in the SSR HTML but is `display: none` until
			// data-edit-mode="true" lands on <html>, which only the JS toggle
			// can set. Without JS the whole flow is inert by design.
			await page.goto('/');
			const card = page.locator('.meetup-card').first();
			await expect(card.locator('[data-edit-toggle]')).toBeHidden();
			await expect(card.locator('[data-edit-panel]')).toBeHidden();
		});
	});
});
