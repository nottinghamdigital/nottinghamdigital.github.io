import { test, expect } from '@playwright/test';

// Whether any of this build's next-events resolved (scripts/fetch-next-events.mjs's
// feeds can be unreachable — that's non-fatal by design, see CLAUDE.md — so a
// run against a build with zero resolved events has nothing for these tests
// to assert against). Established pattern in tests/homepage.spec.ts: skip
// with a reason rather than fail on a content-set difference that isn't a
// regression.
async function firstEventCard(page: import('@playwright/test').Page) {
	const cards = page.locator('#meetup-list > li[data-next-event-date]');
	return { cards, count: await cards.count() };
}

test.describe('Calendar export', () => {
	test('every card with a next event has an add-to-calendar control with three links', async ({
		page,
	}) => {
		await page.goto('/');
		const { cards, count } = await firstEventCard(page);
		test.skip(count === 0, 'no meetup in this build resolved an upcoming event');

		for (let i = 0; i < count; i++) {
			const items = cards.nth(i).locator('.meetup-card__next-events-item');
			const itemCount = await items.count();
			for (let j = 0; j < itemCount; j++) {
				const menu = items.nth(j).locator('.add-to-calendar');
				await expect(menu).toHaveCount(1);
				const links = menu.locator('ul a');
				await expect(links).toHaveCount(3);
				await expect(links.nth(0)).toHaveAttribute(
					'href',
					/^https:\/\/calendar\.google\.com\/calendar\/render\?/,
				);
				await expect(links.nth(1)).toHaveAttribute(
					'href',
					/^https:\/\/outlook\.live\.com\/calendar\//,
				);
				await expect(links.nth(2)).toHaveAttribute(
					'href',
					/^\/calendar\/.+\.ics$/,
				);
			}
		}
	});

	test('the .ics link serves a valid-looking calendar file', async ({ page, request }) => {
		await page.goto('/');
		const { cards, count } = await firstEventCard(page);
		test.skip(count === 0, 'no meetup in this build resolved an upcoming event');

		const icsHref = await cards
			.first()
			.locator('.add-to-calendar a[download]')
			.getAttribute('href');
		expect(icsHref).toBeTruthy();

		// Deliberately no content-type assertion here: locally that would only
		// read back scripts/serve-dist.mjs's own MIME table, which proves
		// nothing about what a real visitor's browser is served. The
		// text/calendar claim is checked where it's real: against the
		// published host, in scripts/check-live-site.mjs.
		const response = await request.get(icsHref!);
		expect(response.status()).toBe(200);
		const body = await response.text();
		expect(body.startsWith('BEGIN:VCALENDAR')).toBe(true);
		expect(body).toContain('BEGIN:VEVENT');
		expect(body).toContain('END:VCALENDAR');
	});

	test('the dt-start time element matches the card\'s next-event date', async ({ page }) => {
		await page.goto('/');
		const { cards, count } = await firstEventCard(page);
		test.skip(count === 0, 'no meetup in this build resolved an upcoming event');

		const card = cards.first();
		const cardDate = await card.getAttribute('data-next-event-date');
		const dtStart = card.locator('time.dt-start').first();
		await expect(dtStart).toHaveAttribute('datetime', cardDate ?? '');
	});

	test('the page\'s JSON-LD parses and contains one Event per rendered next event', async ({
		page,
	}) => {
		await page.goto('/');
		const { count: cardCount } = await firstEventCard(page);
		test.skip(cardCount === 0, 'no meetup in this build resolved an upcoming event');

		const renderedEventCount = await page
			.locator('.meetup-card__next-events-item')
			.count();

		const scripts = await page
			.locator('script[type="application/ld+json"]')
			.allTextContents();
		expect(scripts).toHaveLength(1);

		const graph = JSON.parse(scripts[0]);
		expect(graph['@context']).toBe('https://schema.org');
		const events = graph['@graph'].filter((n: any) => n['@type'] === 'Event');
		expect(events).toHaveLength(renderedEventCount);

		for (const event of events) {
			expect(typeof event.name).toBe('string');
			expect(typeof event.startDate).toBe('string');
			expect(event.organizer?.['@id']).toBeTruthy();
			const organizer = graph['@graph'].find(
				(n: any) => n['@type'] === 'Organization' && n['@id'] === event.organizer['@id'],
			);
			expect(organizer).toBeTruthy();
		}
	});

	test('no uncaught JavaScript errors on load', async ({ page }) => {
		// Uncaught exceptions only, not every console "error" — this build's
		// own inline scripts (the only JS this feature touches: NextUpHero's
		// promote()) throwing is the thing worth catching here. A blanket
		// console-error check would also fail on the Google Fonts stylesheet
		// or the GoatCounter beacon failing to load, which depends on
		// third-party network reachability this feature has no say over
		// (and which homepage.spec.ts doesn't assert on, for the same reason).
		const errors: string[] = [];
		page.on('pageerror', (err) => errors.push(err.message));

		await page.goto('/');
		await page.waitForLoadState('domcontentloaded');
		expect(errors).toEqual([]);
	});
});

test.describe('Calendar export (no JS)', () => {
	test.use({ javaScriptEnabled: false });

	test('the add-to-calendar disclosure opens and all three links are present, without JavaScript', async ({
		page,
	}) => {
		await page.goto('/');
		const { cards, count } = await firstEventCard(page);
		test.skip(count === 0, 'no meetup in this build resolved an upcoming event');

		const menu = cards.first().locator('.add-to-calendar').first();
		await expect(menu).not.toHaveAttribute('open', '');

		// <details> is native browser behaviour, not a JS event handler --
		// clicking <summary> must open it even with javaScriptEnabled: false.
		await menu.locator('summary').click();
		await expect(menu).toHaveAttribute('open', '');

		const links = menu.locator('ul a');
		await expect(links).toHaveCount(3);
		for (let i = 0; i < 3; i++) {
			await expect(links.nth(i)).toHaveAttribute('href', /.+/);
		}
	});
});
