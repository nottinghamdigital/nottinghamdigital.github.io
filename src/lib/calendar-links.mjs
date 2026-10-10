/**
 * Google Calendar and Outlook Web "add event" deep links, and the path this
 * event's own `.ics` file is served at. All three describe the same event
 * as `src/lib/ics.mjs`'s writer — the same end-time fallback (via
 * `resolveEnd`) and the same location text (via `locationText`), imported
 * rather than reimplemented, so the four destinations (file download,
 * Google, Outlook, and the card's own display) cannot drift apart.
 *
 * Operates on the plain event record from
 * `src/data/next-events.generated.json` — `{ title, url, date, end?,
 * location? }` — the same shape `MeetupCard.astro` already has to hand, so
 * no group context needs assembling just to build a link.
 */
import { formatIcsUtc, locationText, resolveEnd } from './ics.mjs';

/**
 * @typedef {import('./ics.mjs').EventLocation} EventLocation
 * @typedef {{ title: string, url: string, date: string, end?: string, location?: EventLocation }} NextEvent
 */

/**
 * A Google Calendar "add event" template link. `URLSearchParams` does the
 * encoding, so a title or venue containing `&`, a comma, or a newline
 * survives round-tripping through `new URL()`.
 *
 * @param {NextEvent} event
 */
export function googleCalendarUrl(event) {
	const start = new Date(event.date);
	const end = resolveEnd(event);
	const params = new URLSearchParams({
		action: 'TEMPLATE',
		text: event.title,
		dates: `${formatIcsUtc(start)}/${formatIcsUtc(end)}`,
		details: event.url,
	});
	const location = locationText(event.location);
	if (location) params.set('location', location);
	return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * An Outlook Web "compose event" deep link.
 *
 * @param {NextEvent} event
 */
export function outlookCalendarUrl(event) {
	const start = new Date(event.date);
	const end = resolveEnd(event);
	const params = new URLSearchParams({
		path: '/calendar/action/compose',
		rru: 'addevent',
		subject: event.title,
		startdt: start.toISOString(),
		enddt: end.toISOString(),
		body: event.url,
	});
	const location = locationText(event.location);
	if (location) params.set('location', location);
	return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}

/**
 * The filename stem (no directory, no extension) identifying this event's
 * calendar file. Exported (rather than folded into `icsPathFor` alone) so
 * `src/pages/calendar/[event].ics.ts`'s `getStaticPaths()` can compute the
 * exact same dynamic-route param a card links to — one function, so the
 * page a link points at and the page Astro actually builds cannot name an
 * event differently.
 *
 * The start time makes the file content-addressed: a rescheduled event gets
 * a new URL rather than a stale cached body, rather than an index-based
 * name serving a *different* event under a bookmarked link. `siblingIndex`
 * disambiguates the one case where a group can have two events at the same
 * instant — an Eventbrite organizer's sibling series.
 *
 * @param {string} slug - The meetup's content-collection id.
 * @param {NextEvent} event
 * @param {number} [siblingIndex]
 */
export function icsFileId(slug, event, siblingIndex = 0) {
	const suffix = siblingIndex > 0 ? `-${siblingIndex + 1}` : '';
	return `${slug}-${formatIcsUtc(event.date)}${suffix}`;
}

/**
 * The path (relative to the site root) this event's own `.ics` file is
 * served at.
 *
 * @param {string} slug
 * @param {NextEvent} event
 * @param {number} [siblingIndex]
 */
export function icsPathFor(slug, event, siblingIndex = 0) {
	return `/calendar/${icsFileId(slug, event, siblingIndex)}.ics`;
}
