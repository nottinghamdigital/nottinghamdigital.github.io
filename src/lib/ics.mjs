/**
 * RFC 5545 (iCalendar) writer, plus the ICS line reader shared with
 * `scripts/fetch-next-events.mjs`'s Luma parser — one module for both, so
 * the writer's output round-trips through the very reader used elsewhere in
 * the build, in `tests/unit/ics.test.ts`, rather than being checked by
 * re-parsing strings by hand.
 *
 * The writer's only public surface is `buildEventIcs()`/`buildIcs()`; every
 * property line those produce — SUMMARY, DTSTART, UID, the VCALENDAR
 * wrapper's own — goes through the single private `line()` function below.
 * `SUMMARY`, `DESCRIPTION` and `LOCATION` are filled from scraped
 * third-party feed text (see `scripts/fetch-next-events.mjs`), so escaping
 * is not a convention to remember at each call site: nothing in this module
 * concatenates a property line by hand or accepts a pre-built one. See
 * `.claude/plans/2026-09-calendar-export.md` for the fuller rationale.
 */

export const CRLF = '\r\n';

const PRODID = '-//Nottingham Digital//nottingham.digital//EN';

/** Assumed event length when a source gave no end time. */
export const DEFAULT_EVENT_DURATION_MINUTES = 120;

/**
 * @typedef {Object} EventLocation
 * @property {string} [name] - Venue name, if known.
 * @property {string} [address] - A single display line, if known.
 * @property {boolean} [online] - True for a purely online event.
 */

/**
 * @typedef {Object} CalendarEvent
 * @property {string} slug - The meetup's content-collection id — used to build a stable UID and filename.
 * @property {string} groupName - The meetup group's display name, for DESCRIPTION.
 * @property {string} [groupSummary] - The group's summary, for DESCRIPTION.
 * @property {string} title - The event's own title.
 * @property {string} url - The event's page.
 * @property {string} date - ISO 8601 start, UTC.
 * @property {string} [end] - ISO 8601 end, UTC. Defaults to `date` + DEFAULT_EVENT_DURATION_MINUTES.
 * @property {EventLocation} [location]
 */

/* ---------------------------------------------------------------------- */
/* The chokepoint                                                          */
/* ---------------------------------------------------------------------- */

/**
 * The only function in this module that produces an ICS line. Every
 * property — SUMMARY, DTSTART, UID, the VCALENDAR wrapper's own — is built
 * here, so escaping and folding cannot be forgotten at a call site and a
 * value cannot introduce a line of its own.
 *
 * `text: false` is for values that are not RFC 5545 TEXT: URI (`URL`),
 * DATE-TIME (`DTSTART`/`DTEND`/`DTSTAMP`), and structural tokens
 * (`BEGIN`/`END`/`VERSION`/`PRODID`/`CALSCALE`/`METHOD`/`STATUS`/`TRANSP`/
 * `UID`). Escaping those as TEXT is not merely unnecessary, it corrupts
 * them — a comma is legal in a URL and would be emitted as `\,`. They still
 * go through here, and still have every control character removed, so the
 * injection property holds for both value types.
 *
 * @param {string} name
 * @param {string} value
 * @param {{ params?: Record<string, string>, text?: boolean }} [opts]
 */
function line(name, value, { params = {}, text = true } = {}) {
	const encoded = text ? escapeText(value) : stripControls(String(value));
	const paramText = Object.entries(params)
		.map(([key, val]) => `;${key}=${stripControls(String(val))}`)
		.join('');
	return fold(`${name}${paramText}:${encoded}`);
}

/**
 * RFC 5545 TEXT escaping. Order matters twice over: backslashes before the
 * characters whose escapes introduce one, and the newline rule before
 * `stripControls`, so a real newline survives as the two characters `\n`
 * while every other control character is removed.
 */
function escapeText(value) {
	return stripControls(
		String(value)
			.replace(/\\/g, '\\\\')
			.replace(/;/g, '\\;')
			.replace(/,/g, '\\,')
			.replace(/\r\n|[\r\n]/g, '\\n'),
	);
}

/** Removes every C0 control character and DEL — CR and LF included. */
function stripControls(value) {
	return value.replace(/[\u0000-\u001f\u007f]/g, '');
}

/**
 * Folds to 75 octets per RFC 5545 §3.1, continuation lines starting with a
 * single space, and never splitting a UTF-8 multi-byte sequence — group
 * names contain em dashes and the occasional emoji.
 */
function fold(text) {
	const bytes = Buffer.from(text, 'utf8');
	if (bytes.length <= 75) return text;
	const parts = [];
	for (let start = 0; start < bytes.length; ) {
		// 75 octets on the first line; 74 after, since the fold's leading space counts.
		let end = Math.min(start + (start === 0 ? 75 : 74), bytes.length);
		// Back off any UTF-8 continuation byte (0b10xxxxxx) so a character is never split.
		while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
		parts.push(
			(start === 0 ? '' : ' ') + bytes.subarray(start, end).toString('utf8'),
		);
		start = end;
	}
	return parts.join(CRLF);
}

/* ---------------------------------------------------------------------- */
/* Reader — shared with scripts/fetch-next-events.mjs's Luma ICS parser   */
/* ---------------------------------------------------------------------- */

/**
 * Unfolds RFC 5545 line continuations (a line starting with a space or tab
 * is a continuation of the previous one) and splits into raw lines.
 */
export function unfoldIcsLines(ics) {
	return ics.replace(/\r\n[ \t]/g, '').split(/\r\n|\n/);
}

/** Un-escapes `\,` `\;` `\n` `\\` — the inverse of `escapeText()` above. */
export function unescapeIcsValue(value) {
	return value
		.replace(/\\n/gi, '\n')
		.replace(/\\,/g, ',')
		.replace(/\\;/g, ';')
		.replace(/\\\\/g, '\\');
}

/* ---------------------------------------------------------------------- */
/* Writer                                                                  */
/* ---------------------------------------------------------------------- */

/**
 * Compact UTC form used in DTSTART/DTEND/DTSTAMP and, via `icsUidFor`, in
 * UIDs and calendar filenames — e.g. `20260928T180000Z`.
 */
export function formatIcsUtc(value) {
	const date = value instanceof Date ? value : new Date(value);
	return date
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Stable and globally unique per event: identical across two builds of the
 * same event (so a re-import updates the existing calendar entry instead of
 * duplicating it), distinct across events (including two events for the
 * same group).
 */
export function icsUidFor(slug, isoDate) {
	return `${slug}-${formatIcsUtc(isoDate)}@nottingham.digital`;
}

/**
 * A single-line LOCATION value from an `EventLocation`, or undefined when
 * there is nothing to show. An online event with no separate venue renders
 * as "Online" rather than being silently dropped.
 */
function locationText(location) {
	if (!location) return undefined;
	const parts = [location.name, location.address].filter(Boolean);
	if (parts.length > 0) return parts.join(', ');
	return location.online ? 'Online' : undefined;
}

function calendarHeaderLines() {
	return [
		line('VERSION', '2.0', { text: false }),
		line('PRODID', PRODID, { text: false }),
		line('CALSCALE', 'GREGORIAN', { text: false }),
		line('METHOD', 'PUBLISH', { text: false }),
	];
}

/**
 * @param {CalendarEvent} event
 * @param {Date} now
 * @param {number} defaultDurationMinutes
 */
function eventLines(event, now, defaultDurationMinutes) {
	const start = new Date(event.date);
	const end = event.end
		? new Date(event.end)
		: new Date(start.getTime() + defaultDurationMinutes * 60_000);

	const description = [event.groupName, event.groupSummary, event.url]
		.filter(Boolean)
		.join('\n\n');

	const lines = [
		line('BEGIN', 'VEVENT', { text: false }),
		line('UID', icsUidFor(event.slug, event.date), { text: false }),
		line('DTSTAMP', formatIcsUtc(now), { text: false }),
		line('DTSTART', formatIcsUtc(start), { text: false }),
		line('DTEND', formatIcsUtc(end), { text: false }),
		line('SUMMARY', event.title),
		line('DESCRIPTION', description),
		line('URL', event.url, { text: false }),
		line('STATUS', 'CONFIRMED', { text: false }),
		line('TRANSP', 'OPAQUE', { text: false }),
	];

	// No ORGANIZER: RFC 5545 wants a mailto: CAL-ADDRESS, we have none, and a
	// fabricated one is worse than omission — some clients surface it as a
	// reply-to address.

	const loc = locationText(event.location);
	if (loc) lines.push(line('LOCATION', loc));

	lines.push(line('END', 'VEVENT', { text: false }));
	return lines;
}

/**
 * One `.ics` file for a single event.
 *
 * @param {CalendarEvent} event
 * @param {{ now: Date, defaultDurationMinutes?: number }} opts - `now` is
 *   injected (build time, in production) rather than read from the clock,
 *   so output is deterministic in tests.
 */
export function buildEventIcs(
	event,
	{ now, defaultDurationMinutes = DEFAULT_EVENT_DURATION_MINUTES },
) {
	return (
		[
			line('BEGIN', 'VCALENDAR', { text: false }),
			...calendarHeaderLines(),
			...eventLines(event, now, defaultDurationMinutes),
			line('END', 'VCALENDAR', { text: false }),
		].join(CRLF) + CRLF
	);
}

/**
 * One `.ics` file for every event given — the whole-site subscription feed.
 *
 * @param {CalendarEvent[]} events
 * @param {{ now: Date, defaultDurationMinutes?: number, calendarName?: string }} opts
 */
export function buildIcs(
	events,
	{ now, defaultDurationMinutes = DEFAULT_EVENT_DURATION_MINUTES, calendarName },
) {
	const header = [
		line('BEGIN', 'VCALENDAR', { text: false }),
		...calendarHeaderLines(),
	];
	if (calendarName) {
		header.push(
			line('X-WR-CALNAME', calendarName),
			line('REFRESH-INTERVAL', 'PT24H', {
				params: { VALUE: 'DURATION' },
				text: false,
			}),
			line('X-PUBLISHED-TTL', 'PT24H', { text: false }),
		);
	}
	const body = events.flatMap((event) =>
		eventLines(event, now, defaultDurationMinutes),
	);
	return (
		[...header, ...body, line('END', 'VCALENDAR', { text: false })].join(
			CRLF,
		) + CRLF
	);
}
