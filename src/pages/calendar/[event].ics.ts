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
import { loadNextEvents, toCalendarEvents } from '../../lib/next-events.mjs';

type CalendarEvent = import('../../lib/ics.mjs').CalendarEvent;

export const getStaticPaths = (async () => {
	const meetups = await getCollection('meetups');
	const nextEvents = await loadNextEvents();
	const events = toCalendarEvents(meetups, nextEvents);

	// Almost always one event per group; an Eventbrite organizer's sibling
	// series can occasionally share a start time, hence the counter keyed on
	// slug+date rather than assuming every event is already unique in time.
	const seenAtInstant = new Map<string, number>();

	return events.map((calendarEvent) => {
		const key = `${calendarEvent.slug}|${calendarEvent.date}`;
		const siblingIndex = seenAtInstant.get(key) ?? 0;
		seenAtInstant.set(key, siblingIndex + 1);

		return {
			params: { event: icsFileId(calendarEvent.slug, calendarEvent, siblingIndex) },
			props: { calendarEvent },
		};
	});
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ calendarEvent: CalendarEvent }> = ({ props }) => {
	const ics = buildEventIcs(props.calendarEvent, { now: new Date() });
	return new Response(ics, {
		headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
	});
};
