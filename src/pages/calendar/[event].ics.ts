// One static .ics file per resolved next event, at
// /calendar/<slug>-<compact UTC start>[-N].ics — see icsFileId() in
// src/lib/calendar-links.mjs for exactly how that name is built, shared
// with the links MeetupCard.astro renders so a card never links to a page
// this file doesn't also generate.
//
// Kept a thin shell deliberately: everything worth unit-testing (escaping,
// folding, the 120-minute fallback) lives in src/lib/ics.mjs, which imports
// nothing from astro:content and so needs no Astro/vitest plumbing to test.
import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import { buildEventIcs } from '../../lib/ics.mjs';
import { icsFileId } from '../../lib/calendar-links.mjs';
import { loadNextEvents } from '../../lib/next-events.mjs';

type CalendarEvent = import('../../lib/ics.mjs').CalendarEvent;
type NextEvent = import('../../lib/calendar-links.mjs').NextEvent;

export const getStaticPaths = (async () => {
	const meetups = await getCollection('meetups');
	const meetupsById = new Map(meetups.map((m) => [m.id, m]));
	const nextEvents = await loadNextEvents();

	const paths: {
		params: { event: string };
		props: { calendarEvent: CalendarEvent };
	}[] = [];

	for (const [slug, events] of Object.entries(nextEvents)) {
		const meetup = meetupsById.get(slug);
		if (!meetup) continue; // stale entry for a meetup file that's since been removed

		// Almost always one event per group; an Eventbrite organizer's sibling
		// series can occasionally share a start time, hence the counter rather
		// than assuming each event in the array is already unique in time.
		const seenAtInstant = new Map<string, number>();
		for (const event of events as NextEvent[]) {
			const siblingIndex = seenAtInstant.get(event.date) ?? 0;
			seenAtInstant.set(event.date, siblingIndex + 1);

			paths.push({
				params: { event: icsFileId(slug, event, siblingIndex) },
				props: {
					calendarEvent: {
						slug,
						groupName: meetup.data.name,
						groupSummary: meetup.data.summary,
						title: event.title,
						url: event.url,
						date: event.date,
						end: event.end,
						location: event.location,
					},
				},
			});
		}
	}

	return paths;
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ calendarEvent: CalendarEvent }> = ({ props }) => {
	const ics = buildEventIcs(props.calendarEvent, { now: new Date() });
	return new Response(ics, {
		headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
	});
};
