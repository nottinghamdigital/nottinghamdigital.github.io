// Fetches the next upcoming event per meetup group from meetup.com's per-group
// RSS feed, and writes the results to src/data/next-events.generated.json.
//
// Runs before `astro build` (see package.json). Network failures are
// non-fatal: a group with no reachable feed simply gets no entry, and
// MeetupCard falls back to showing only the static cadence text.
import { XMLParser } from 'fast-xml-parser';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';

const MEETUPS_DIR = new URL('../src/content/meetups/', import.meta.url);
const OUTPUT_FILE = new URL(
	'../src/data/next-events.generated.json',
	import.meta.url,
);

const MEETUP_COM_URL = /^https:\/\/www\.meetup\.com\/([^/]+)\/?/;
const LUMA_URL = /^https:\/\/(?:www\.)?(?:lu\.ma|luma\.com)\/([^/?#]+)\/?/;
const BUILT_IN_NOTTS_URL = /^https:\/\/(?:www\.)?builtinnotts\.com\/events\/?/;

/** @returns {Promise<{ slug: string, events?: string }[]>} */
async function loadMeetups() {
	const files = (await readdir(MEETUPS_DIR)).filter((f) => f.endsWith('.yml'));
	const meetups = [];
	for (const file of files) {
		const raw = await readFile(new URL(file, MEETUPS_DIR), 'utf-8');
		const data = parse(raw);
		meetups.push({ slug: path.basename(file, '.yml'), events: data.events });
	}
	return meetups;
}

const USER_AGENT = 'nottingham.digital next-events fetcher';

/**
 * The RSS feed's <pubDate> is when the feed was generated, not when the
 * event happens — the actual date only appears as free text in the title
 * ("Thursday, 15th September"). The event's own page carries a proper
 * schema.org Event <script type="application/ld+json"> block with a real
 * `startDate`, so each RSS item is followed up with one fetch of its event
 * page to get an accurate, sortable date.
 */
async function fetchEventStartDate(eventUrl) {
	let html;
	try {
		const res = await fetch(eventUrl, { headers: { 'User-Agent': USER_AGENT } });
		if (!res.ok) {
			console.warn(`[next-events] ${eventUrl} → HTTP ${res.status}`);
			return null;
		}
		html = await res.text();
	} catch (err) {
		console.warn(`[next-events] ${eventUrl} → ${err.message}`);
		return null;
	}

	for (const match of html.matchAll(
		/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs,
	)) {
		try {
			const data = JSON.parse(match[1]);
			if (data['@type'] === 'Event' && data.startDate) {
				const date = new Date(data.startDate);
				if (!Number.isNaN(date.getTime())) return date;
			}
		} catch {
			// not JSON, or not the block we want — try the next one
		}
	}
	console.warn(`[next-events] no Event startDate found on ${eventUrl}`);
	return null;
}

/**
 * Fetches a meetup.com group's RSS feed and returns its earliest upcoming
 * event, or null if the feed can't be fetched/parsed or has no items.
 */
async function fetchMeetupComNextEvent(groupSlug) {
	const feedUrl = `https://www.meetup.com/${groupSlug}/events/rss/`;
	let xml;
	try {
		const res = await fetch(feedUrl, { headers: { 'User-Agent': USER_AGENT } });
		if (!res.ok) {
			console.warn(`[next-events] ${feedUrl} → HTTP ${res.status}`);
			return null;
		}
		xml = await res.text();
	} catch (err) {
		console.warn(`[next-events] ${feedUrl} → ${err.message}`);
		return null;
	}

	let candidates;
	try {
		const parser = new XMLParser();
		const doc = parser.parse(xml);
		const items = doc?.rss?.channel?.item;
		const list = Array.isArray(items) ? items : items ? [items] : [];
		candidates = list
			.map((item) => ({
				title: String(item.title ?? '').trim(),
				link: String(item.link ?? '').trim(),
			}))
			.filter((e) => e.title && e.link);
	} catch (err) {
		console.warn(`[next-events] failed to parse ${feedUrl}: ${err.message}`);
		return null;
	}
	if (candidates.length === 0) return null;

	const now = new Date();
	const events = (
		await Promise.all(
			candidates.map(async (c) => {
				const date = await fetchEventStartDate(c.link);
				return date && { title: c.title, url: c.link, date };
			}),
		)
	)
		.filter(Boolean)
		.filter((e) => e.date.getTime() > now.getTime())
		.sort((a, b) => a.date.getTime() - b.date.getTime());
	if (events.length === 0) return null;

	const next = events[0];
	return { title: next.title, url: next.url, date: next.date.toISOString() };
}

/**
 * Unfolds RFC 5545 line continuations (a line starting with a space is a
 * continuation of the previous one) and un-escapes `\,` `\;` `\n` `\\`.
 */
function unescapeIcsValue(value) {
	return value
		.replace(/\\n/gi, '\n')
		.replace(/\\,/g, ',')
		.replace(/\\;/g, ';')
		.replace(/\\\\/g, '\\');
}

function unfoldIcsLines(ics) {
	return ics.replace(/\r\n[ \t]/g, '').split(/\r\n|\n/);
}

/**
 * Luma's public calendar page doesn't have its events in the static HTML
 * (they're loaded client-side), so the next event is read from Luma's public
 * iCal feed instead — the same feed backing the page's "Add iCal
 * Subscription" button. That feed needs the calendar's internal `cal-...`
 * id, which the calendar page's embedded JSON does carry statically.
 */
async function fetchLumaCalendarId(calendarUrl) {
	let html;
	try {
		const res = await fetch(calendarUrl, {
			headers: { 'User-Agent': USER_AGENT },
		});
		if (!res.ok) {
			console.warn(`[next-events] ${calendarUrl} → HTTP ${res.status}`);
			return null;
		}
		html = await res.text();
	} catch (err) {
		console.warn(`[next-events] ${calendarUrl} → ${err.message}`);
		return null;
	}

	const match = html.match(/"api_id":"(cal-[^"]+)"/);
	if (!match) {
		console.warn(`[next-events] no calendar id found on ${calendarUrl}`);
		return null;
	}
	return match[1];
}

/**
 * Fetches a Luma calendar's next upcoming event via its public iCal feed, or
 * null if the calendar/feed can't be fetched/parsed or has no future events.
 */
async function fetchLumaNextEvent(calendarSlug) {
	const calendarUrl = `https://luma.com/${calendarSlug}`;
	const calendarId = await fetchLumaCalendarId(calendarUrl);
	if (!calendarId) return null;

	const feedUrl = `https://api.lu.ma/ics/get?entity=calendar&id=${calendarId}`;
	let ics;
	try {
		const res = await fetch(feedUrl, { headers: { 'User-Agent': USER_AGENT } });
		if (!res.ok) {
			console.warn(`[next-events] ${feedUrl} → HTTP ${res.status}`);
			return null;
		}
		ics = await res.text();
	} catch (err) {
		console.warn(`[next-events] ${feedUrl} → ${err.message}`);
		return null;
	}

	const lines = unfoldIcsLines(ics);
	const events = [];
	let current = null;
	for (const line of lines) {
		if (line === 'BEGIN:VEVENT') {
			current = {};
		} else if (line === 'END:VEVENT') {
			if (current?.title && current?.start) events.push(current);
			current = null;
		} else if (current) {
			const colonIndex = line.indexOf(':');
			if (colonIndex === -1) continue;
			const key = line.slice(0, colonIndex).split(';')[0];
			const value = unescapeIcsValue(line.slice(colonIndex + 1));
			if (key === 'SUMMARY') current.title = value;
			if (key === 'DTSTART') {
				// Bare (no VALUE=DATE param) DTSTART with a trailing Z is UTC, e.g. 20260908T180000Z.
				const m = value.match(
					/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/,
				);
				current.start = m
					? new Date(
							Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]),
						)
					: new Date(value);
			}
			if (key === 'DESCRIPTION') {
				const urlMatch = value.match(/https:\/\/luma\.com\/\S+/);
				if (urlMatch) current.url = urlMatch[0];
			}
		}
	}

	const now = new Date();
	const upcoming = events
		.filter((e) => e.start instanceof Date && !Number.isNaN(e.start.getTime()))
		.filter((e) => e.start.getTime() > now.getTime())
		.sort((a, b) => a.start.getTime() - b.start.getTime());
	if (upcoming.length === 0) return null;

	const next = upcoming[0];
	return {
		title: next.title,
		url: next.url ?? calendarUrl,
		date: next.start.toISOString(),
	};
}

const HTML_ENTITIES = {
	'&amp;': '&',
	'&#x27;': "'",
	'&quot;': '"',
	'&#x2F;': '/',
	'&lt;': '<',
	'&gt;': '>',
};

function decodeHtmlEntities(value) {
	return value.replace(
		/&(?:amp|#x27|quot|#x2F|lt|gt);/g,
		(entity) => HTML_ENTITIES[entity],
	);
}

/**
 * Built In Notts has no feed at all — its events page is server-rendered
 * Next.js markup, so the next event is scraped directly out of each
 * `<article>` card's heading, `<time datetime>`, and "View Event Details"
 * link. Brittle by nature: if their page markup changes this will just stop
 * matching and quietly return null, same as any other unreachable source.
 */
async function fetchBuiltInNottsNextEvent(eventsUrl) {
	let html;
	try {
		const res = await fetch(eventsUrl, { headers: { 'User-Agent': USER_AGENT } });
		if (!res.ok) {
			console.warn(`[next-events] ${eventsUrl} → HTTP ${res.status}`);
			return null;
		}
		html = await res.text();
	} catch (err) {
		console.warn(`[next-events] ${eventsUrl} → ${err.message}`);
		return null;
	}

	const cardPattern =
		/<article[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<time datetime="([^"]+)"[\s\S]*?<a target="_self"[^>]*href="([^"]+)"/gi;

	const now = new Date();
	const events = [...html.matchAll(cardPattern)]
		.map((m) => ({
			title: decodeHtmlEntities(m[1]).trim(),
			date: new Date(m[2]),
			url: decodeHtmlEntities(m[3]),
		}))
		.filter((e) => e.title && e.url && !Number.isNaN(e.date.getTime()))
		.filter((e) => e.date.getTime() > now.getTime())
		.sort((a, b) => a.date.getTime() - b.date.getTime());

	if (events.length === 0) return null;
	const next = events[0];
	return { title: next.title, url: next.url, date: next.date.toISOString() };
}

async function main() {
	const meetups = await loadMeetups();
	const result = {};

	await Promise.all(
		meetups.map(async ({ slug, events }) => {
			const meetupMatch = MEETUP_COM_URL.exec(events ?? '');
			if (meetupMatch) {
				const event = await fetchMeetupComNextEvent(meetupMatch[1]);
				if (event) result[slug] = event;
				return;
			}

			const lumaMatch = LUMA_URL.exec(events ?? '');
			if (lumaMatch) {
				const event = await fetchLumaNextEvent(lumaMatch[1]);
				if (event) result[slug] = event;
				return;
			}

			if (BUILT_IN_NOTTS_URL.test(events ?? '')) {
				const event = await fetchBuiltInNottsNextEvent(events);
				if (event) result[slug] = event;
				return;
			}

			// No `events` value, or no known source for it — skip.
		}),
	);

	await mkdir(new URL('.', OUTPUT_FILE), { recursive: true });
	await writeFile(OUTPUT_FILE, JSON.stringify(result, null, '\t') + '\n');
	console.log(
		`[next-events] wrote ${Object.keys(result).length}/${meetups.length} events to src/data/next-events.generated.json`,
	);
}

await main();
