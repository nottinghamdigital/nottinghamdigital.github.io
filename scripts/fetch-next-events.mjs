// Fetches each meetup group's upcoming events from its `events` field
// (meetup.com, Luma, or Eventbrite) and writes them to
// src/data/next-events.generated.json, soonest first. For Eventbrite, a group
// whose organizer runs more than one recurring series (e.g. a weekly meetup
// and separate monthly socials) gets one entry per series — those siblings
// are discovered from the organizer's public profile page rather than
// needing to be listed by hand.
//
// Runs before `astro build` (see package.json). Network failures are
// non-fatal: a source that can't be fetched simply contributes no entry, and
// MeetupCard falls back to showing only the static cadence text if none
// resolve.
import { XMLParser } from 'fast-xml-parser';
import {
	appendFile,
	readdir,
	readFile,
	writeFile,
	mkdir,
} from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';

const MEETUPS_DIR = new URL('../src/content/meetups/', import.meta.url);
const OUTPUT_FILE = new URL(
	'../src/data/next-events.generated.json',
	import.meta.url,
);

const MEETUP_COM_URL = /^https:\/\/www\.meetup\.com\/([^/]+)\/?/;
const LUMA_URL = /^https:\/\/(?:www\.)?(?:lu\.ma|luma\.com)\/([^/?#]+)\/?/;
const EVENTBRITE_URL = /^https:\/\/(?:www\.)?eventbrite\.(?:com|co\.uk)\/e\/[^/?#]+\/?$/;

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

/** Max sibling events (beyond the one the group's `events` field points at) pulled in per Eventbrite organizer. */
const MAX_EVENTBRITE_SIBLINGS = 4;

async function fetchJson(url) {
	let html;
	try {
		const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
		if (!res.ok) {
			console.warn(`[next-events] ${url} → HTTP ${res.status}`);
			return null;
		}
		html = await res.text();
	} catch (err) {
		console.warn(`[next-events] ${url} → ${err.message}`);
		return null;
	}

	const match = html.match(
		/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
	);
	if (!match) {
		console.warn(`[next-events] no __NEXT_DATA__ found on ${url}`);
		return null;
	}
	try {
		return JSON.parse(match[1]);
	} catch (err) {
		console.warn(`[next-events] failed to parse __NEXT_DATA__ on ${url}: ${err.message}`);
		return null;
	}
}

/**
 * Eventbrite event pages embed their data as a `__NEXT_DATA__` JSON blob
 * rather than schema.org markup with a usable date: for a recurring event
 * (`context.basicInfo.isSeries`), the JSON-LD/`basicInfo.startDate` is the
 * *first* occurrence and `endDate` is when the series ends — neither is "the
 * next one". `context.goodToKnow.highlights.nextAvailableSession` is the
 * field Eventbrite's own page uses to answer that, and covers both series and
 * one-off events, so it's used directly instead of scraping a date picker.
 *
 * Also returns the organizer's profile URL, so the caller can look up any
 * other events the same organizer runs.
 */
async function fetchEventbriteEventDetails(eventUrl) {
	const context = (await fetchJson(eventUrl))?.props?.pageProps?.context;
	if (!context) return null;

	const basicInfo = context.basicInfo;
	const dateStr =
		context.goodToKnow?.highlights?.nextAvailableSession ??
		basicInfo?.startDate?.utc;
	if (!basicInfo?.name || !dateStr) {
		console.warn(`[next-events] no next session date found on ${eventUrl}`);
		return null;
	}

	// nextAvailableSession carries a short UTC offset like "+01" rather than
	// "+01:00", which Date can't parse.
	const date = new Date(dateStr.replace(/([+-]\d{2})$/, '$1:00'));
	if (Number.isNaN(date.getTime())) {
		console.warn(`[next-events] unparseable date "${dateStr}" on ${eventUrl}`);
		return null;
	}
	if (date.getTime() <= Date.now()) return null;

	return {
		title: basicInfo.name,
		url: basicInfo.url ?? eventUrl,
		date: date.toISOString(),
		organizerUrl: basicInfo.organizer?.url ?? null,
	};
}

/**
 * An Eventbrite organizer's public profile page (`/o/<slug>-<id>`) also
 * server-renders its own upcoming events — one entry per distinct series, not
 * per occurrence — in `pageProps.upcomingEvents`. Used to find a group's other
 * recurring events (e.g. monthly socials alongside a weekly meetup) starting
 * from just the one event page a meetup lists, rather than requiring every
 * sibling series to be listed by hand.
 */
async function fetchEventbriteOrganizerEventUrls(organizerUrl) {
	const events = (await fetchJson(organizerUrl))?.props?.pageProps
		?.upcomingEvents;
	if (!Array.isArray(events)) return [];
	return events.map((e) => e.url).filter((url) => typeof url === 'string');
}

/**
 * Resolves a group's Eventbrite listing to its next occurrence, plus the next
 * occurrence of any other series run by the same organizer.
 */
async function fetchEventbriteNextEvents(eventUrl) {
	const primary = await fetchEventbriteEventDetails(eventUrl);
	if (!primary) return [];

	const siblingUrls = primary.organizerUrl
		? (await fetchEventbriteOrganizerEventUrls(primary.organizerUrl))
				.filter((url) => url !== eventUrl)
				.slice(0, MAX_EVENTBRITE_SIBLINGS)
		: [];

	const siblings = (
		await Promise.all(siblingUrls.map(fetchEventbriteEventDetails))
	).filter(Boolean);

	return [primary, ...siblings]
		.sort((a, b) => new Date(a.date) - new Date(b.date))
		.map(({ title, url, date }) => ({ title, url, date }));
}

/**
 * Dispatches a meetup's `events` value to whichever fetcher recognises it,
 * returning every upcoming event it resolves to (usually one, but an
 * Eventbrite organizer running multiple series can contribute several).
 */
async function fetchNextEventsForSource(events) {
	const meetupMatch = MEETUP_COM_URL.exec(events ?? '');
	if (meetupMatch) {
		const event = await fetchMeetupComNextEvent(meetupMatch[1]);
		return event ? [event] : [];
	}

	const lumaMatch = LUMA_URL.exec(events ?? '');
	if (lumaMatch) {
		const event = await fetchLumaNextEvent(lumaMatch[1]);
		return event ? [event] : [];
	}

	if (EVENTBRITE_URL.test(events ?? '')) return fetchEventbriteNextEvents(events);

	return null;
}

async function main() {
	const meetups = await loadMeetups();
	const result = {};

	await Promise.all(
		meetups.map(async ({ slug, events }) => {
			const resolved = await fetchNextEventsForSource(events);
			if (resolved === null) {
				if (!events) {
					console.warn(`[next-events] ${slug} has no events field — skipping`);
				} else {
					console.warn(
						`[next-events] ${slug} events value "${events}" matches no known source — skipping`,
					);
				}
				return;
			}
			if (resolved.length > 0) result[slug] = resolved;
		}),
	);

	await mkdir(new URL('.', OUTPUT_FILE), { recursive: true });
	await writeFile(OUTPUT_FILE, JSON.stringify(result, null, '\t') + '\n');

	const resolved = Object.keys(result);
	const missing = meetups
		.map((m) => m.slug)
		.filter((slug) => !(slug in result))
		.sort();

	console.log(
		`[next-events] wrote ${resolved.length}/${meetups.length} events to src/data/next-events.generated.json`,
	);
	if (missing.length > 0) {
		console.log(`[next-events] no upcoming event for: ${missing.join(', ')}`);
	}

	await writeStepSummary(meetups.length, resolved.length, missing);
}

/**
 * Records the run in the GitHub Actions job summary, so a deploy that quietly
 * resolved fewer events than usual is visible on the run page rather than only
 * in the logs. A failure here is never worth failing the build over, and
 * outside Actions there is no summary file, so this is a no-op locally.
 */
async function writeStepSummary(total, resolved, missing) {
	const summaryFile = process.env.GITHUB_STEP_SUMMARY;
	if (!summaryFile) return;

	const lines = [
		'### Next events',
		'',
		`Resolved **${resolved} of ${total}** groups.`,
		'',
	];
	if (missing.length > 0) {
		lines.push('No upcoming event found for:', '');
		lines.push(...missing.map((slug) => `- \`${slug}\``));
		lines.push('');
	}

	try {
		await appendFile(summaryFile, lines.join('\n') + '\n');
	} catch (err) {
		console.warn(`[next-events] could not write job summary: ${err.message}`);
	}
}

await main();
