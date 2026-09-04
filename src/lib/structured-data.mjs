/**
 * Builds the schema.org JSON-LD graph for `index.astro`'s `<head>`: one
 * `Event` per resolved next event, plus one `Organization` per meetup group
 * that has at least one (never duplicated when a group has several, via an
 * Eventbrite organizer's sibling series).
 *
 * Rendered once, in `<head>`, rather than as `itemscope`/`itemprop`
 * microdata on each card — the hero (`NextUpHero.astro`) rewrites its own
 * DOM when an event passes, so attribute-based markup on that card would go
 * stale, and a single block is one thing to maintain and one thing to
 * unit-test. The nodes are combined with `@graph` and `organizer: { "@id":
 * … }` cross-references rather than a formal schema.org `ItemList` wrapper,
 * which search engines document Events being read from directly rather than
 * nested inside `itemListElement`.
 */

/**
 * @typedef {import('./calendar-links.mjs').NextEvent} NextEvent
 * @typedef {{ id: string, data: { name: string, url: string, summary: string } }} MeetupEntry
 */

/**
 * @param {MeetupEntry[]} meetups
 * @param {Record<string, NextEvent[]>} nextEvents - Keyed by meetup id, as
 *   produced by `src/lib/next-events.mjs`.
 * @returns {object | null} `null` when there are no upcoming events at all,
 *   rather than a `@graph` with no `Event` in it.
 */
export function eventGraph(meetups, nextEvents) {
	const meetupsById = new Map(meetups.map((m) => [m.id, m]));
	/** @type {Map<string, object>} Organization nodes, keyed by @id (the group's URL). */
	const organizations = new Map();
	const events = [];

	for (const [slug, resolvedEvents] of Object.entries(nextEvents)) {
		const meetup = meetupsById.get(slug);
		if (!meetup) continue; // stale entry for a meetup file that's since been removed

		for (const event of resolvedEvents) {
			if (!organizations.has(meetup.data.url)) {
				organizations.set(meetup.data.url, {
					'@type': 'Organization',
					'@id': meetup.data.url,
					name: meetup.data.name,
					url: meetup.data.url,
					description: meetup.data.summary,
				});
			}
			events.push(eventNode(event, meetup.data.url));
		}
	}

	if (events.length === 0) return null;

	return {
		'@context': 'https://schema.org',
		'@graph': [...organizations.values(), ...events],
	};
}

/**
 * @param {NextEvent} event
 * @param {string} organizerId
 */
function eventNode(event, organizerId) {
	/** @type {any} */
	const node = {
		'@type': 'Event',
		name: event.title,
		startDate: event.date,
		url: event.url,
		eventStatus: 'https://schema.org/EventScheduled',
		eventAttendanceMode: event.location?.online
			? 'https://schema.org/OnlineEventAttendanceMode'
			: 'https://schema.org/OfflineEventAttendanceMode',
		organizer: { '@id': organizerId },
	};

	// endDate is included only when the source actually gave one. Like
	// location below (and unlike the ICS file, which needs *some* end to be
	// a valid calendar entry), fabricating a duration into public structured
	// data would invent precision we don't have.
	if (event.end) node.endDate = event.end;

	const location = schemaLocation(event.location, event.url);
	if (location) node.location = location;

	return node;
}

/**
 * @param {import('./ics.mjs').EventLocation} [location]
 * @param {string} eventUrl
 */
function schemaLocation(location, eventUrl) {
	if (!location) return undefined;
	if (location.online) return { '@type': 'VirtualLocation', url: eventUrl };
	if (location.name || location.address) {
		/** @type {any} */
		const place = { '@type': 'Place' };
		if (location.name) place.name = location.name;
		if (location.address) place.address = location.address;
		return place;
	}
	return undefined;
}

/**
 * Serialises a graph for a `<script type="application/ld+json">` element.
 * `JSON.stringify` never leaves a value unescaped, but a scraped title or
 * venue containing a literal `</script>` would still close the element
 * early in the surrounding HTML — `<` is escaped to the six characters `\u003c` (a valid JSON
 * string escape, and invisible to any JSON-LD consumer) to rule that out.
 *
 * @param {object} graph
 * @returns {string}
 */
export function toJsonLdScript(graph) {
	return JSON.stringify(graph).replace(/</g, '\\u003c');
}
