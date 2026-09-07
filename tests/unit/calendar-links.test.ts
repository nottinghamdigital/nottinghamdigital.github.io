import { describe, it, expect } from 'vitest';
import {
	googleCalendarUrl,
	outlookCalendarUrl,
	icsPathFor,
} from '../../src/lib/calendar-links.mjs';
import { buildEventIcs, DEFAULT_EVENT_DURATION_MINUTES } from '../../src/lib/ics.mjs';

function baseEvent(overrides = {}) {
	return {
		title: 'Monthly meetup',
		url: 'https://www.meetup.com/dotnetnotts/events/123456/',
		date: '2026-09-28T18:00:00.000Z',
		...overrides,
	};
}

describe('googleCalendarUrl', () => {
	it('points at the Google Calendar render endpoint with the expected params', () => {
		const url = new URL(googleCalendarUrl(baseEvent()));
		expect(url.hostname).toBe('calendar.google.com');
		expect(url.pathname).toBe('/calendar/render');
		expect(url.searchParams.get('action')).toBe('TEMPLATE');
		expect(url.searchParams.get('text')).toBe('Monthly meetup');
		expect(url.searchParams.get('dates')).toBe(
			'20260928T180000Z/20260928T200000Z',
		);
	});

	it('encodes a title with & and a newline, surviving a URL round-trip', () => {
		const title = 'Tea & Talk\nSession two';
		const url = new URL(googleCalendarUrl(baseEvent({ title })));
		expect(url.searchParams.get('text')).toBe(title);
	});

	it('includes location only when the event has one', () => {
		const withLocation = new URL(
			googleCalendarUrl(
				baseEvent({ location: { name: 'Tech Hub', address: '1 Example St' } }),
			),
		);
		expect(withLocation.searchParams.get('location')).toBe(
			'Tech Hub, 1 Example St',
		);

		const without = new URL(googleCalendarUrl(baseEvent()));
		expect(without.searchParams.has('location')).toBe(false);
	});

	it('applies the same 120-minute fallback as the ICS builder when no end is known', () => {
		const url = new URL(googleCalendarUrl(baseEvent()));
		const [, endParam] = url.searchParams.get('dates')!.split('/');

		const ics = buildEventIcs(
			{ slug: 'dot-net-notts', groupName: '.NET Notts', ...baseEvent() },
			{ now: new Date('2026-09-01T00:00:00.000Z') },
		);
		const dtend = ics
			.split('\r\n')
			.find((l) => l.startsWith('DTEND:'))!
			.slice('DTEND:'.length);

		expect(endParam).toBe(dtend);
		expect(DEFAULT_EVENT_DURATION_MINUTES).toBe(120);
	});
});

describe('outlookCalendarUrl', () => {
	it('points at the Outlook Web deeplink compose endpoint with the expected params', () => {
		const url = new URL(outlookCalendarUrl(baseEvent()));
		expect(url.hostname).toBe('outlook.live.com');
		expect(url.searchParams.get('path')).toBe('/calendar/action/compose');
		expect(url.searchParams.get('rru')).toBe('addevent');
		expect(url.searchParams.get('subject')).toBe('Monthly meetup');
	});

	it('uses full ISO 8601 for startdt/enddt', () => {
		const url = new URL(
			outlookCalendarUrl(baseEvent({ end: '2026-09-28T19:15:00.000Z' })),
		);
		expect(url.searchParams.get('startdt')).toBe('2026-09-28T18:00:00.000Z');
		expect(url.searchParams.get('enddt')).toBe('2026-09-28T19:15:00.000Z');
	});
});

describe('icsPathFor', () => {
	it('is stable for a given slug and event, and unique across events', () => {
		const event = baseEvent();
		const a = icsPathFor('dot-net-notts', event);
		const b = icsPathFor('dot-net-notts', event);
		expect(a).toBe(b);
		expect(a).toBe('/calendar/dot-net-notts-20260928T180000Z.ics');

		const other = icsPathFor(
			'dot-net-notts',
			baseEvent({ date: '2026-10-05T18:00:00.000Z' }),
		);
		expect(other).not.toBe(a);

		const otherGroup = icsPathFor('codebar', event);
		expect(otherGroup).not.toBe(a);
	});

	it('disambiguates same-instant sibling events with an index suffix', () => {
		const event = baseEvent();
		const primary = icsPathFor('some-org', event, 0);
		const sibling = icsPathFor('some-org', event, 1);
		expect(primary).not.toBe(sibling);
		expect(sibling.endsWith('-2.ics')).toBe(true);
	});
});
