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

	test('every category filter button has an icon, "All" does not', async ({ page }) => {
		await page.goto('/');
		const categoryFilters = page.locator('[data-filter]:not([data-filter="all"])');
		const count = await categoryFilters.count();
		expect(count).toBeGreaterThan(0);
		for (let i = 0; i < count; i++) {
			await expect(categoryFilters.nth(i).locator('.filter__icon')).toHaveCount(1);
		}
		await expect(page.locator('[data-filter="all"] .filter__icon')).toHaveCount(0);
	});

	test('a filter button exists for every category present in the meetup list, and no others', async ({
		page,
	}) => {
		await page.goto('/');
		const cardCategories = await page
			.locator('#meetup-list > li')
			.evaluateAll((cards) =>
				[...new Set(cards.map((c) => c.getAttribute('data-category')))].sort(),
			);
		const filterCategories = await page
			.locator('[data-filter]:not([data-filter="all"])')
			.evaluateAll((buttons) =>
				buttons.map((b) => b.getAttribute('data-filter')).sort(),
			);
		expect(filterCategories).toEqual(cardCategories);
	});

	test('switching between two category filters only keeps the latest pressed', async ({
		page,
	}) => {
		await page.goto('/');
		const categoryFilters = page.locator('[data-filter]:not([data-filter="all"])');
		test.skip(
			(await categoryFilters.count()) < 2,
			'needs at least two categories in the current content set',
		);

		const first = categoryFilters.nth(0);
		const second = categoryFilters.nth(1);

		await first.click();
		await expect(first).toHaveAttribute('aria-pressed', 'true');

		await second.click();
		await expect(second).toHaveAttribute('aria-pressed', 'true');
		await expect(first).toHaveAttribute('aria-pressed', 'false');

		await page.locator('[data-filter="all"]').click();
		await expect(page.locator('[data-filter="all"]')).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		await expect(page.locator('#meetup-list > li[hidden]')).toHaveCount(0);
	});

	test('the status region announces the filtered count and category', async ({ page }) => {
		await page.goto('/');
		const firstCategoryFilter = page.locator('[data-filter]:not([data-filter="all"])').first();
		const categoryId = await firstCategoryFilter.getAttribute('data-filter');
		await firstCategoryFilter.click();

		const visibleCount = await page.locator('#meetup-list > li:not([hidden])').count();
		const word = visibleCount === 1 ? 'meetup' : 'meetups';
		await expect(page.locator('[data-filter-status]')).toHaveText(
			`Showing ${visibleCount} ${word} in ${categoryId}.`,
		);
	});
});

test.describe('Theme toggle', () => {
	test('defaults to auto with no stored preference', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('[data-theme-option="auto"]')).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		await expect(page.locator('[data-theme-option="light"]')).toHaveAttribute(
			'aria-pressed',
			'false',
		);
		await expect(page.locator('[data-theme-option="dark"]')).toHaveAttribute(
			'aria-pressed',
			'false',
		);
		const theme = await page.evaluate(() => document.documentElement.dataset.theme);
		expect(theme).toBeUndefined();
	});

	test('choosing dark sets the attribute, persists it, and updates the pressed state', async ({
		page,
	}) => {
		await page.goto('/');
		await page.locator('[data-theme-option="dark"]').click();

		await expect(page.locator('[data-theme-option="dark"]')).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		await expect(page.locator('[data-theme-option="auto"]')).toHaveAttribute(
			'aria-pressed',
			'false',
		);

		const theme = await page.evaluate(() => document.documentElement.dataset.theme);
		expect(theme).toBe('dark');

		const stored = await page.evaluate(() => localStorage.getItem('nd-theme'));
		expect(stored).toBe('dark');

		const colorScheme = await page
			.locator('html')
			.evaluate((el) => getComputedStyle(el).colorScheme);
		expect(colorScheme).toBe('dark');
	});

	test('choosing auto after an explicit choice clears the stored preference', async ({
		page,
	}) => {
		await page.goto('/');
		await page.locator('[data-theme-option="light"]').click();
		expect(await page.evaluate(() => localStorage.getItem('nd-theme'))).toBe('light');

		await page.locator('[data-theme-option="auto"]').click();
		await expect(page.locator('[data-theme-option="auto"]')).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		expect(await page.evaluate(() => localStorage.getItem('nd-theme'))).toBeNull();
		expect(
			await page.evaluate(() => document.documentElement.dataset.theme),
		).toBeUndefined();
	});

	test('announces the change via the status region', async ({ page }) => {
		await page.goto('/');
		await page.locator('[data-theme-option="dark"]').click();
		await expect(page.locator('[data-theme-status]')).toHaveText('Theme set to Dark.');
	});

	test('applies a previously stored theme on load, without needing a toggle click', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			localStorage.setItem('nd-theme', 'dark');
		});
		await page.goto('/');

		expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(
			'dark',
		);
		await expect(page.locator('[data-theme-option="dark"]')).toHaveAttribute(
			'aria-pressed',
			'true',
		);
	});
});

test.describe('Progressive enhancement (no JS)', () => {
	test.use({ javaScriptEnabled: false });

	test('filters and theme toggle stay hidden, and all meetups render', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('.filters')).toBeHidden();
		await expect(page.locator('.theme-toggle')).toBeHidden();

		const cards = page.locator('#meetup-list > li');
		await expect(cards).not.toHaveCount(0);
		await expect(page.locator('#meetup-list > li[hidden]')).toHaveCount(0);
	});

	test.describe('and the OS prefers dark', () => {
		test.use({ colorScheme: 'dark' });

		test('dark tokens still apply via prefers-color-scheme alone', async ({ page }) => {
			await page.goto('/');
			const background = await page
				.locator('body')
				.evaluate((el) => getComputedStyle(el).backgroundColor);
			expect(background).toBe('rgb(22, 24, 28)');
		});
	});
});

test.describe('Analytics', () => {
	test('loads the GoatCounter beacon asynchronously', async ({ page }) => {
		await page.goto('/');
		const beacon = page.locator('script[data-goatcounter]');
		await expect(beacon).toHaveCount(1);
		await expect(beacon).toHaveAttribute(
			'data-goatcounter',
			'https://nottinghamdigital.goatcounter.com/count',
		);
		await expect(beacon).toHaveAttribute('async', '');
	});

	// The footer promises "no cookies, no personal data". These are the tests
	// that keep that promise true if the analytics setup is ever changed —
	// GoatCounter writes nothing to the device today, and swapping in anything
	// that does should fail here rather than quietly make the footer a lie.
	test('sets no cookies', async ({ page, context }) => {
		await page.goto('/');
		expect(await context.cookies()).toEqual([]);
	});

	test('writes nothing to browser storage', async ({ page }) => {
		await page.goto('/');
		const stored = await page.evaluate(() => ({
			local: Object.keys(localStorage),
			session: Object.keys(sessionStorage),
		}));
		// `nd-theme` is written by the theme toggle, and only on a click.
		expect(stored).toEqual({ local: [], session: [] });
	});
});

test.describe('Past events', () => {
	// Event data comes from live feeds fetched at build time (see
	// scripts/fetch-next-events.mjs), so these tests discover real dates from
	// the built page rather than hardcoding fixture dates, and skip when the
	// current data doesn't happen to contain the shape they need.

	test('hides a next event once its start time has passed, and drops it from the Upcoming filter', async ({
		page,
	}) => {
		await page.goto('/');
		const dates = await page
			.locator('[data-next-events] li[data-event-date]')
			.evaluateAll((els) => els.map((el) => el.getAttribute('data-event-date')));
		test.skip(dates.length === 0, 'no upcoming events in the generated data');
		const afterEverything =
			Math.max(...dates.map((d) => new Date(d ?? '').getTime())) + 24 * 60 * 60 * 1000;

		await page.clock.install({ time: afterEverything });
		await page.goto('/');

		await expect(page.locator('[data-next-events]:visible')).toHaveCount(0);
		await expect(page.locator('[data-category][data-next-event-date]')).toHaveCount(0);

		const upcomingToggle = page.locator('[data-toggle="upcoming"]');
		await upcomingToggle.click();
		await expect(page.locator('#meetup-list > li:visible')).toHaveCount(0);
	});

	test('on a meetup with multiple upcoming events, hides only the one that has passed', async ({
		page,
	}) => {
		await page.goto('/');
		const groups = await page.evaluate(() =>
			Array.from(document.querySelectorAll('[data-next-events]'))
				.map((block) =>
					Array.from(block.querySelectorAll('li[data-event-date]'))
						.map((li) => li.getAttribute('data-event-date') ?? '')
						.sort(),
				)
				.filter((dates) => dates.length >= 2),
		);
		test.skip(groups.length === 0, 'no meetup currently has 2+ upcoming events');
		const [first, second] = groups[0];
		const between = (new Date(first).getTime() + new Date(second).getTime()) / 2;

		await page.clock.install({ time: between });
		await page.goto('/');

		const state = await page.evaluate(
			([first, second]) => {
				const li = document.querySelector(`li[data-event-date="${first}"]`);
				const nextLi = document.querySelector(`li[data-event-date="${second}"]`);
				const card = li?.closest('.meetup-card');
				return {
					firstHidden: li instanceof HTMLElement ? li.hidden : null,
					secondHidden: nextLi instanceof HTMLElement ? nextLi.hidden : null,
					cardNextEventDate: card?.getAttribute('data-next-event-date'),
				};
			},
			[first, second],
		);
		expect(state.firstHidden).toBe(true);
		expect(state.secondHidden).toBe(false);
		expect(state.cardNextEventDate).toBe(second);
	});

	test('promotes the next same-day event in the hero once the current one has passed', async ({
		page,
	}) => {
		await page.goto('/');
		const heroDates = await page.evaluate(() => {
			const root = document.querySelector('.next-up');
			return root
				? Array.from(root.querySelectorAll('[data-event-date]')).map((el) =>
						el.getAttribute('data-event-date'),
					)
				: [];
		});
		const sorted = [...new Set(heroDates.map((d) => new Date(d ?? '').getTime()))].sort(
			(a, b) => a - b,
		);
		test.skip(sorted.length < 2, 'no day currently has 2+ distinct hero event times');
		const between = (sorted[0] + sorted[1]) / 2;

		await page.clock.install({ time: between });
		await page.goto('/');

		const hero = page.locator('.next-up');
		await expect(hero).toBeVisible();
		const primaryDate = await page
			.locator('.next-up__card[data-primary]')
			.getAttribute('data-event-date');
		expect(new Date(primaryDate ?? '').getTime()).toBeGreaterThanOrEqual(sorted[1]);
	});

	test('hides the hero entirely once every event on its day has passed', async ({ page }) => {
		await page.goto('/');
		const heroDates = await page.evaluate(() => {
			const root = document.querySelector('.next-up');
			return root
				? Array.from(root.querySelectorAll('[data-event-date]')).map((el) =>
						el.getAttribute('data-event-date'),
					)
				: [];
		});
		test.skip(heroDates.length === 0, 'no hero rendered in the current generated data');
		const afterEverything =
			Math.max(...heroDates.map((d) => new Date(d ?? '').getTime())) + 60 * 60 * 1000;

		await page.clock.install({ time: afterEverything });
		await page.goto('/');

		await expect(page.locator('.next-up')).toBeHidden();
	});
});

test.describe('Monitoring metadata', () => {
	// scripts/check-live-site.mjs reads this stamp off the published page to
	// tell whether the daily deploy is still running. Losing it would break
	// the monitor silently, so the contract is asserted here instead.
	test('stamps a parseable build time into the page', async ({ page }) => {
		await page.goto('/');
		const buildTime = await page
			.locator('meta[name="build-time"]')
			.getAttribute('content');
		expect(buildTime).toBeTruthy();
		expect(Number.isNaN(Date.parse(buildTime ?? ''))).toBe(false);
	});
});
