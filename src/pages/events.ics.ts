// Every resolved next event in one subscribable calendar, at /events.ics --
// the natural companion to the per-event files in calendar/: a visitor who
// wants everything on the site's radar, not just one group's next date, can
// subscribe once (webcal://nottingham.digital/events.ics from the footer)
// and let the daily deploy keep it fresh, rather than re-downloading a file
// per event as things change.
//
// Kept a thin shell like the per-event endpoint: the merge and the writer
// both live in src/lib/, so there is nothing here worth unit-testing on its
// own.
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { buildIcs } from '../lib/ics.mjs';
import { loadNextEvents, toCalendarEvents } from '../lib/next-events.mjs';

export const GET: APIRoute = async () => {
	const meetups = await getCollection('meetups');
	const nextEvents = await loadNextEvents();
	const events = toCalendarEvents(meetups, nextEvents);

	const ics = buildIcs(events, {
		now: new Date(),
		calendarName: 'Nottingham Digital',
	});
	return new Response(ics, {
		headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
	});
};
