import { test, expect } from '@playwright/test';

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

	test('displays meetup list', async ({ page }) => {
		await page.goto('/');
		const meetups = page.locator('#meetup-list > li');
		await expect(meetups).not.toHaveCount(0);
	});

	test('meetup cards have required content', async ({ page }) => {
		await page.goto('/');
		const firstCard = page.locator('#meetup-list > li').first();
		await expect(firstCard).toBeVisible();
		await expect(firstCard.locator('a').first()).toHaveAttribute('href', /.+/);
	});

	test('category filters are present', async ({ page }) => {
		await page.goto('/');
		const filters = page.locator('[data-filter]');
		await expect(filters).not.toHaveCount(0);
	});

	test('filtering meetups by category works', async ({ page }) => {
		await page.goto('/');
		const totalMeetups = await page.locator('#meetup-list > li').count();
		// Click the first non-"all" filter button
		const firstCategoryFilter = page.locator('[data-filter]:not([data-filter="all"])').first();
		await firstCategoryFilter.click();
		await expect(firstCategoryFilter).toHaveAttribute('aria-pressed', 'true');
		const visibleMeetups = await page
			.locator('#meetup-list > li:not([hidden])')
			.count();
		expect(visibleMeetups).toBeLessThan(totalMeetups);
	});
});
