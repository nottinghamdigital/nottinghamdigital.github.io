import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { CATEGORIES } from '../src/data/categories';

const MEETUPS_DIR = join(process.cwd(), 'src/content/meetups');

function readMeetups() {
	return readdirSync(MEETUPS_DIR)
		.filter((file) => file.endsWith('.yml'))
		.map((file) => {
			const content = readFileSync(join(MEETUPS_DIR, file), 'utf8');
			const name = content.match(/^name:\s+(.+)$/m)?.[1]?.trim();
			const category = content.match(/^category:\s+(.+)$/m)?.[1]?.trim();

			if (!name || !category) {
				throw new Error(`Expected ${file} to define name and category`);
			}

			return { name, category };
		});
}

const meetups = readMeetups();
const categoryCounts = meetups.reduce((counts, meetup) => {
	counts.set(meetup.category, (counts.get(meetup.category) ?? 0) + 1);
	return counts;
}, new Map<string, number>());
const activeCategoryIds = CATEGORIES.filter((category) => categoryCounts.has(category.id)).map(
	(category) => category.id,
);
const inactiveCategoryIds = CATEGORIES.filter((category) => !categoryCounts.has(category.id)).map(
	(category) => category.id,
);
const filterableCategory = activeCategoryIds.find(
	(categoryId) => (categoryCounts.get(categoryId) ?? 0) < meetups.length,
);

test.describe('Homepage', () => {
	test('has correct title', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveTitle(
			'Nottingham Digital: Design and Development Events for the Tech Community',
		);
	});

	test('displays site header and strapline', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('.site-strap')).toHaveText(
			'Local events for the tech community.',
		);
	});

	test('renders every meetup from the content files', async ({ page }) => {
		await page.goto('/');
		const meetupCards = page.locator('#meetup-list > li');
		await expect(meetupCards).toHaveCount(meetups.length);

		for (const meetup of meetups) {
			await expect(
				page.locator('#meetup-list > li .meetup-card__link').filter({ hasText: meetup.name }),
			).toHaveCount(1);
		}
	});

	test('meetup cards include a link, summary, and cadence', async ({ page }) => {
		await page.goto('/');
		const cards = page.locator('#meetup-list > li');

		for (let index = 0; index < meetups.length; index++) {
			const card = cards.nth(index);
			await expect(card.locator('.meetup-card__link')).toHaveAttribute('href', /^https?:\/\/.+/);
			await expect(card.locator('.meetup-card__summary')).toHaveText(/\S+/);
			await expect(card.locator('.meetup-card__cadence')).toHaveText(/\S+/);
		}
	});

	test('category filters only render categories present in the current content', async ({ page }) => {
		await page.goto('/');
		const filters = page.locator('[data-filter]');
		await expect(filters).toHaveCount(activeCategoryIds.length + 1);

		for (const categoryId of activeCategoryIds) {
			await expect(page.locator(`[data-filter="${categoryId}"]`)).toHaveCount(1);
		}

		for (const categoryId of inactiveCategoryIds) {
			await expect(page.locator(`[data-filter="${categoryId}"]`)).toHaveCount(0);
		}
	});

	test('filtering meetups by category works', async ({ page }) => {
		test.skip(!filterableCategory, 'Current meetup content only has one category.');
		if (!filterableCategory) return;

		await page.goto('/');
		const expectedVisible = categoryCounts.get(filterableCategory) ?? 0;
		const filter = page.locator(`[data-filter="${filterableCategory}"]`);

		await filter.click();
		await expect(filter).toHaveAttribute('aria-pressed', 'true');
		await expect(page.locator('[data-filter="all"]')).toHaveAttribute('aria-pressed', 'false');
		await expect(page.locator('#meetup-list > li:not([hidden])')).toHaveCount(expectedVisible);
		await expect(page.locator('#meetup-list > li[hidden]')).toHaveCount(meetups.length - expectedVisible);
		await expect(page.locator('[data-filter-status]')).toHaveText(
			`Showing ${expectedVisible} meetup${expectedVisible === 1 ? '' : 's'} in ${filterableCategory}.`,
		);

		const visibleCards = page.locator('#meetup-list > li:not([hidden])');
		for (let index = 0; index < expectedVisible; index++) {
			await expect(visibleCards.nth(index)).toHaveAttribute('data-category', filterableCategory);
		}
	});
});
