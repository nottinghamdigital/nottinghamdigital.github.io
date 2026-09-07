/**
 * Reads `src/data/next-events.generated.json`, written by
 * `scripts/fetch-next-events.mjs` before the build. Shared by
 * `src/pages/index.astro`, `src/pages/calendar/[event].ics.ts` and
 * `src/pages/events.ics.ts` so all three consume the exact same data through
 * the exact same fallback, rather than separate inlined reads that could
 * disagree about what "no data yet" means.
 *
 * The file is gitignored and may not exist — `astro dev` without a prior
 * build, or a fresh checkout — so a missing or unparsable file resolves to
 * `{}` rather than throwing, and every card falls back to its static
 * cadence text. Consistent with the rest of this script: a feed failure is
 * never fatal to the build.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * @typedef {import('./calendar-links.mjs').NextEvent} NextEvent
 */

const NEXT_EVENTS_PATH = path.join(
	process.cwd(),
	'src/data/next-events.generated.json',
);

/**
 * @returns {Promise<Record<string, NextEvent[]>>} Keyed by meetup
 *   content-collection id (the YAML filename stem).
 */
export async function loadNextEvents() {
	return readFile(NEXT_EVENTS_PATH, 'utf-8')
		.then((raw) => JSON.parse(raw))
		.catch(() => ({}));
}

/**
 * Merges each resolved next event with its meetup's group context (slug,
 * name, summary) into the `CalendarEvent` shape `src/lib/ics.mjs`'s writer
 * expects. Shared by the per-event `.ics` endpoint and the whole-site feed,
 * so both skip a stale next-events entry — a meetup file that's since been
 * removed, whose generated data hasn't caught up yet — the same way rather
 * than each reimplementing the lookup.
 *
 * @param {{ id: string, data: { name: string, url: string, summary: string } }[]} meetups
 * @param {Record<string, NextEvent[]>} nextEvents
 * @returns {import('./ics.mjs').CalendarEvent[]}
 */
export function toCalendarEvents(meetups, nextEvents) {
	const meetupsById = new Map(meetups.map((m) => [m.id, m]));
	const events = [];

	for (const [slug, resolvedEvents] of Object.entries(nextEvents)) {
		const meetup = meetupsById.get(slug);
		if (!meetup) continue;

		for (const event of resolvedEvents) {
			events.push({
				slug,
				groupName: meetup.data.name,
				groupSummary: meetup.data.summary,
				title: event.title,
				url: event.url,
				date: event.date,
				end: event.end,
				location: event.location,
			});
		}
	}

	return events;
}
