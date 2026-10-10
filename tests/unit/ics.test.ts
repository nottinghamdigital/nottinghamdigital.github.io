import { describe, it, expect } from 'vitest';
import ICAL from 'ical.js';
import {
	buildEventIcs,
	buildIcs,
	icsUidFor,
	formatIcsUtc,
	unfoldIcsLines,
	unescapeIcsValue,
	DEFAULT_EVENT_DURATION_MINUTES,
} from '../../src/lib/ics.mjs';

const NOW = new Date('2026-09-01T12:00:00.000Z');

function baseEvent(overrides = {}) {
	return {
		slug: 'dot-net-notts',
		groupName: '.NET Notts',
		groupSummary: 'Microsoft technologies, best practices, and frameworks.',
		title: 'Monthly meetup',
		url: 'https://www.meetup.com/dotnetnotts/events/123456/',
		date: '2026-09-28T18:00:00.000Z',
		...overrides,
	};
}

/** Splits on the real line terminator, dropping the trailing empty entry. */
function rawLines(ics: string) {
	return ics.split('\r\n').slice(0, -1);
}

describe('buildEventIcs', () => {
	it('uses CRLF throughout, including the final line', () => {
		const ics = buildEventIcs(baseEvent(), { now: NOW });
		expect(ics.includes('\n')).toBe(true); // sanity: there are line breaks at all
		expect(ics.split('\n').every((l) => l === '' || l.endsWith('\r'))).toBe(
			true,
		);
		expect(ics.endsWith('\r\n')).toBe(true);
		// No bare \n anywhere that isn't part of a \r\n pair.
		expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
	});

	it('contains the required properties in a valid BEGIN/END nesting', () => {
		const lines = rawLines(buildEventIcs(baseEvent(), { now: NOW }));
		expect(lines[0]).toBe('BEGIN:VCALENDAR');
		expect(lines.at(-1)).toBe('END:VCALENDAR');
		expect(lines).toContain('VERSION:2.0');
		expect(
			lines.some((l) => l.startsWith('PRODID:')),
		).toBe(true);
		expect(lines).toContain('CALSCALE:GREGORIAN');
		expect(lines).toContain('METHOD:PUBLISH');

		const veventStart = lines.indexOf('BEGIN:VEVENT');
		const veventEnd = lines.indexOf('END:VEVENT');
		expect(veventStart).toBeGreaterThan(-1);
		expect(veventEnd).toBeGreaterThan(veventStart);

		for (const required of [
			'UID:',
			'DTSTAMP:',
			'DTSTART:',
			'DTEND:',
			'SUMMARY:',
			'DESCRIPTION:',
			'URL:',
			'STATUS:CONFIRMED',
			'TRANSP:OPAQUE',
		]) {
			expect(lines.some((l) => l.startsWith(required))).toBe(true);
		}

		// No ORGANIZER — we have no mailto: address to give it.
		expect(lines.some((l) => l.startsWith('ORGANIZER'))).toBe(false);
	});

	it('folds long lines to at most 75 octets, and unfolds back to the original value', () => {
		const longAddress =
			'1 Very Long Street Name That Goes On For Quite A While, ' +
			'Nottingham, England, United Kingdom, NG1 1AA';
		const ics = buildEventIcs(
			baseEvent({ location: { name: 'Venue', address: longAddress } }),
			{ now: NOW },
		);

		for (const line of rawLines(ics)) {
			expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
		}

		// Round-trip through our own reader: unfolding + unescaping reproduces
		// the original value.
		const unfolded = unfoldIcsLines(ics);
		const locationLine = unfolded.find((l) => l.startsWith('LOCATION:'));
		expect(locationLine).toBeDefined();
		const value = unescapeIcsValue(locationLine!.slice('LOCATION:'.length));
		expect(value).toBe(`Venue, ${longAddress}`);
	});

	it('never splits a multi-byte UTF-8 sequence when folding', () => {
		// An em dash and an emoji, repeated to force a fold across the boundary.
		const title = '📅 Monthly meetup — Nottingham — the .NET crowd — 📍 venue TBC — 🎉';
		const ics = buildEventIcs(baseEvent({ title }), { now: NOW });

		for (const line of rawLines(ics)) {
			// A line that starts mid-character decodes with a replacement
			// character or throws on strict decoders; Buffer's default decoder
			// is lenient, so check explicitly for U+FFFD instead.
			expect(Buffer.from(line, 'utf8').toString('utf8')).not.toContain(
				'\uFFFD',
			);
			expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
		}

		const unfolded = unfoldIcsLines(ics);
		const summaryLine = unfolded.find((l) => l.startsWith('SUMMARY:'));
		expect(unescapeIcsValue(summaryLine!.slice('SUMMARY:'.length))).toBe(
			title,
		);
	});

	it('escapes commas, semicolons, backslashes and newlines in TEXT values', () => {
		const ics = buildEventIcs(
			baseEvent({
				title: 'A, title; with a \\backslash\nand a newline',
			}),
			{ now: NOW },
		);
		const unfolded = unfoldIcsLines(ics);
		const summaryLine = unfolded.find((l) => l.startsWith('SUMMARY:'))!;
		const rawValue = summaryLine.slice('SUMMARY:'.length);

		expect(rawValue).toBe(
			'A\\, title\\; with a \\\\backslash\\nand a newline',
		);
		expect(unescapeIcsValue(rawValue)).toBe(
			'A, title; with a \\backslash\nand a newline',
		);
	});

	it('the chokepoint invariant: an injected title cannot open a second VEVENT or a raw property', () => {
		const ics = buildEventIcs(
			baseEvent({
				title: 'Evil\r\nBEGIN:VEVENT\r\nSUMMARY:evil\r\nEND:VEVENT',
			}),
			{ now: NOW },
		);
		const lines = unfoldIcsLines(ics).filter(Boolean);

		expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
		expect(lines.filter((l) => l === 'END:VEVENT')).toHaveLength(1);
		expect(lines.some((l) => l === 'SUMMARY:evil')).toBe(false);
	});

	it('every emitted line either opens a property or is a fold continuation', () => {
		const ics = buildEventIcs(
			baseEvent({
				title:
					'Evil\r\nBEGIN:VEVENT\r\nSUMMARY:evil, with a long enough tail to maybe fold across a boundary and still not open a raw line',
				location: { name: 'Venue', address: 'A, comma-separated, address' },
			}),
			{ now: NOW },
		);
		for (const line of rawLines(ics)) {
			expect(line).toMatch(/^([A-Z][A-Z0-9-]*[;:]| )/);
		}
	});

	it('contains an injected non-TEXT value (a URL) too, by removal rather than escaping', () => {
		const ics = buildEventIcs(
			baseEvent({
				url: 'https://example.com/e/1\r\nSUMMARY:evil\r\nBEGIN:VEVENT',
			}),
			{ now: NOW },
		);
		const lines = unfoldIcsLines(ics).filter(Boolean);
		expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
		expect(lines.some((l) => l === 'SUMMARY:evil')).toBe(false);
		// The CR/LF are simply gone — a URL has no escape sequence to fall back on.
		expect(lines.some((l) => l.startsWith('URL:'))).toBe(true);
	});

	it('a comma in a URL survives unescaped, while the same comma in SUMMARY is escaped', () => {
		const ics = buildEventIcs(
			baseEvent({
				title: 'A title, with a comma',
				url: 'https://example.com/e/1?a=1,2',
			}),
			{ now: NOW },
		);
		const lines = unfoldIcsLines(ics);
		expect(lines.find((l) => l.startsWith('URL:'))).toBe(
			'URL:https://example.com/e/1?a=1,2',
		);
		expect(lines.find((l) => l.startsWith('SUMMARY:'))).toBe(
			'SUMMARY:A title\\, with a comma',
		);
	});

	it('UID is identical across two builds of the same event, and distinct across events', () => {
		const a1 = buildEventIcs(baseEvent(), { now: NOW });
		const a2 = buildEventIcs(baseEvent(), {
			now: new Date('2026-09-05T00:00:00.000Z'),
		});
		const b = buildEventIcs(
			baseEvent({ date: '2026-10-05T18:00:00.000Z' }),
			{ now: NOW },
		);

		const uidOf = (ics: string) =>
			unfoldIcsLines(ics)
				.find((l) => l.startsWith('UID:'))
				?.slice('UID:'.length);

		expect(uidOf(a1)).toBe(uidOf(a2));
		expect(uidOf(a1)).not.toBe(uidOf(b));
		expect(uidOf(a1)).toBe(icsUidFor('dot-net-notts', '2026-09-28T18:00:00.000Z'));
	});

	it('formats DTSTART/DTEND/DTSTAMP as compact UTC', () => {
		const lines = unfoldIcsLines(buildEventIcs(baseEvent(), { now: NOW }));
		expect(lines.find((l) => l.startsWith('DTSTART:'))).toBe(
			'DTSTART:20260928T180000Z',
		);
		expect(lines.find((l) => l.startsWith('DTSTAMP:'))).toBe(
			'DTSTAMP:20260901T120000Z',
		);
		expect(formatIcsUtc('2026-09-28T18:00:00.000Z')).toBe('20260928T180000Z');
	});

	it('defaults DTEND to start + 120 minutes when no end is known', () => {
		const lines = unfoldIcsLines(buildEventIcs(baseEvent(), { now: NOW }));
		expect(DEFAULT_EVENT_DURATION_MINUTES).toBe(120);
		expect(lines.find((l) => l.startsWith('DTEND:'))).toBe(
			'DTEND:20260928T200000Z',
		);
	});

	it('uses the given end time when one is known', () => {
		const lines = unfoldIcsLines(
			buildEventIcs(baseEvent({ end: '2026-09-28T19:15:00.000Z' }), {
				now: NOW,
			}),
		);
		expect(lines.find((l) => l.startsWith('DTEND:'))).toBe(
			'DTEND:20260928T191500Z',
		);
	});

	it('omits LOCATION entirely when the location is unknown, rather than emitting an empty one', () => {
		const lines = unfoldIcsLines(buildEventIcs(baseEvent(), { now: NOW }));
		expect(lines.some((l) => l.startsWith('LOCATION'))).toBe(false);
	});

	it('renders a known venue in LOCATION, combining name and address', () => {
		const lines = unfoldIcsLines(
			buildEventIcs(
				baseEvent({ location: { name: 'Tech Hub', address: '1 Example St' } }),
				{ now: NOW },
			),
		);
		const locationLine = lines.find((l) => l.startsWith('LOCATION:'))!;
		// LOCATION is a TEXT property, so the comma joining name and address is
		// escaped like any other — this is the same rule the "…while the same
		// comma in SUMMARY is escaped" case pins, applied to the value this
		// function builds rather than one passed straight through.
		expect(locationLine).toBe('LOCATION:Tech Hub\\, 1 Example St');
		expect(unescapeIcsValue(locationLine.slice('LOCATION:'.length))).toBe(
			'Tech Hub, 1 Example St',
		);
	});

	it('renders an online event with no venue as "Online"', () => {
		const lines = unfoldIcsLines(
			buildEventIcs(baseEvent({ location: { online: true } }), { now: NOW }),
		);
		expect(lines.find((l) => l.startsWith('LOCATION:'))).toBe(
			'LOCATION:Online',
		);
	});

	it('takes DTSTAMP from the injected `now`, not the system clock', () => {
		const fixed = new Date('2020-01-01T00:00:00.000Z');
		const lines = unfoldIcsLines(buildEventIcs(baseEvent(), { now: fixed }));
		expect(lines.find((l) => l.startsWith('DTSTAMP:'))).toBe(
			'DTSTAMP:20200101T000000Z',
		);
	});
});

describe('buildIcs', () => {
	it('emits one VEVENT per event, sharing a single VCALENDAR wrapper', () => {
		const ics = buildIcs(
			[
				baseEvent(),
				baseEvent({ slug: 'codebar', date: '2026-10-01T18:00:00.000Z' }),
			],
			{ now: NOW },
		);
		const lines = rawLines(ics);
		expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(2);
		expect(lines[0]).toBe('BEGIN:VCALENDAR');
		expect(lines.at(-1)).toBe('END:VCALENDAR');
	});

	it('adds X-WR-CALNAME and refresh hints only when a calendar name is given', () => {
		const withName = rawLines(
			buildIcs([baseEvent()], { now: NOW, calendarName: 'Nottingham Digital' }),
		);
		expect(withName.some((l) => l === 'X-WR-CALNAME:Nottingham Digital')).toBe(
			true,
		);
		expect(
			withName.some((l) => l === 'REFRESH-INTERVAL;VALUE=DURATION:PT24H'),
		).toBe(true);
		expect(withName.some((l) => l === 'X-PUBLISHED-TTL:PT24H')).toBe(true);

		const withoutName = rawLines(buildIcs([baseEvent()], { now: NOW }));
		expect(withoutName.some((l) => l.startsWith('X-WR-CALNAME'))).toBe(false);
	});
});

// Our own reader (unfoldIcsLines/unescapeIcsValue) agreeing with our own
// writer proves the two are consistent with each other, not that either is
// RFC 5545-correct -- ical.js is an independent, widely-used implementation
// with no shared code or assumptions, so parsing our output with it is a
// real compliance check rather than the writer grading its own homework.
describe('buildEventIcs output parses correctly in ical.js (an independent implementation)', () => {
	function parseFirstVevent(ics: string) {
		const comp = new ICAL.Component(ICAL.parse(ics));
		const vevent = comp.getFirstSubcomponent('vevent');
		if (!vevent) throw new Error('no VEVENT found in parsed ICS');
		return { vevent, event: new ICAL.Event(vevent) };
	}

	it('parses a plain event with the expected fields', () => {
		const ics = buildEventIcs(
			baseEvent({ location: { name: 'Tech Hub', address: '1 Example St' } }),
			{ now: NOW },
		);
		const { vevent, event } = parseFirstVevent(ics);

		expect(event.summary).toBe('Monthly meetup');
		expect(event.uid).toBe(
			icsUidFor('dot-net-notts', '2026-09-28T18:00:00.000Z'),
		);
		expect(event.startDate.toJSDate().toISOString()).toBe(
			'2026-09-28T18:00:00.000Z',
		);
		expect(event.endDate.toJSDate().toISOString()).toBe(
			'2026-09-28T20:00:00.000Z', // default 120-minute duration
		);
		expect(vevent.getFirstPropertyValue('location')).toBe(
			'Tech Hub, 1 Example St',
		);
		expect(String(vevent.getFirstPropertyValue('url'))).toBe(
			'https://www.meetup.com/dotnetnotts/events/123456/',
		);
	});

	it('round-trips folded, escaped, and multi-byte text unchanged', () => {
		const title = '📅 Monthly meetup — a title, with; a backslash\\ and a — dash';
		const address =
			'1 Very Long Street Name That Goes On For Quite A While, Nottingham, England, NG1 1AA';
		const ics = buildEventIcs(
			baseEvent({
				title,
				location: { name: 'Venue, with a comma', address },
			}),
			{ now: NOW },
		);
		const { vevent, event } = parseFirstVevent(ics);

		expect(event.summary).toBe(title);
		expect(vevent.getFirstPropertyValue('location')).toBe(
			`Venue, with a comma, ${address}`,
		);
	});

	it('does not let an injected value open a second VEVENT or a raw property', () => {
		const ics = buildEventIcs(
			baseEvent({
				title: 'Evil\r\nBEGIN:VEVENT\r\nSUMMARY:evil\r\nEND:VEVENT',
			}),
			{ now: NOW },
		);
		const comp = new ICAL.Component(ICAL.parse(ics));
		expect(comp.getAllSubcomponents('vevent')).toHaveLength(1);
		const vevent = comp.getFirstSubcomponent('vevent');
		expect(vevent?.getFirstPropertyValue('summary')).toContain('BEGIN:VEVENT');
	});

	it('parses a multi-event calendar with the exact event count', () => {
		const ics = buildIcs(
			[baseEvent(), baseEvent({ slug: 'codebar', date: '2026-10-01T18:00:00.000Z' })],
			{ now: NOW, calendarName: 'Nottingham Digital' },
		);
		const comp = new ICAL.Component(ICAL.parse(ics));
		expect(comp.getAllSubcomponents('vevent')).toHaveLength(2);
	});
});
