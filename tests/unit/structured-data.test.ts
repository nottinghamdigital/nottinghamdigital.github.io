import { describe, it, expect } from 'vitest';
import { eventGraph, toJsonLdScript } from '../../src/lib/structured-data.mjs';

function meetup(id: string, overrides = {}) {
	return {
		id,
		data: {
			name: id,
			url: `https://example.com/${id}`,
			summary: `Summary for ${id}`,
			...overrides,
		},
	};
}

describe('eventGraph', () => {
	it('returns null when there are no upcoming events at all', () => {
		expect(eventGraph([meetup('a')], {})).toBeNull();
	});

	it('produces JSON-serialisable output with the schema.org context', () => {
		const graph = eventGraph(
			[meetup('a')],
			{ a: [{ title: 'Talk', url: 'https://example.com/a/1', date: '2026-09-28T18:00:00.000Z' }] },
		);
		expect(() => JSON.stringify(graph)).not.toThrow();
		expect(graph!['@context']).toBe('https://schema.org');
	});

	it('emits one Event per upcoming event and one Organization per group, however many events it has', () => {
		const graph = eventGraph(
			[meetup('a')],
			{
				a: [
					{ title: 'Session 1', url: 'https://example.com/a/1', date: '2026-09-28T18:00:00.000Z' },
					{ title: 'Session 2', url: 'https://example.com/a/2', date: '2026-10-05T18:00:00.000Z' },
				],
			},
		);
		const nodes = graph!['@graph'] as any[];
		expect(nodes.filter((n) => n['@type'] === 'Event')).toHaveLength(2);
		expect(nodes.filter((n) => n['@type'] === 'Organization')).toHaveLength(1);
	});

	it('every Event.organizer.@id resolves to an Organization node in the same graph', () => {
		const graph = eventGraph(
			[meetup('a'), meetup('b')],
			{
				a: [{ title: 'Talk A', url: 'https://example.com/a/1', date: '2026-09-28T18:00:00.000Z' }],
				b: [{ title: 'Talk B', url: 'https://example.com/b/1', date: '2026-10-01T18:00:00.000Z' }],
			},
		);
		const nodes = graph!['@graph'] as any[];
		const orgIds = new Set(
			nodes.filter((n) => n['@type'] === 'Organization').map((n) => n['@id']),
		);
		for (const event of nodes.filter((n) => n['@type'] === 'Event')) {
			expect(orgIds.has(event.organizer['@id'])).toBe(true);
		}
	});

	it('skips a next-events entry whose meetup no longer exists in the collection', () => {
		const graph = eventGraph(
			[meetup('a')],
			{
				a: [{ title: 'Talk', url: 'https://example.com/a/1', date: '2026-09-28T18:00:00.000Z' }],
				'removed-group': [
					{ title: 'Ghost', url: 'https://example.com/x/1', date: '2026-09-28T18:00:00.000Z' },
				],
			},
		);
		const nodes = graph!['@graph'] as any[];
		expect(nodes.filter((n) => n['@type'] === 'Event')).toHaveLength(1);
	});

	it('includes location when the event has one, and omits it (not null) when it does not', () => {
		const graph = eventGraph(
			[meetup('a')],
			{
				a: [
					{
						title: 'With venue',
						url: 'https://example.com/a/1',
						date: '2026-09-28T18:00:00.000Z',
						location: { name: 'Tech Hub', address: '1 Example St' },
					},
					{
						title: 'Without venue',
						url: 'https://example.com/a/2',
						date: '2026-10-05T18:00:00.000Z',
					},
				],
			},
		);
		const [withVenue, withoutVenue] = (graph!['@graph'] as any[]).filter(
			(n) => n['@type'] === 'Event',
		);
		expect(withVenue.location).toEqual({
			'@type': 'Place',
			name: 'Tech Hub',
			address: '1 Example St',
		});
		expect('location' in withoutVenue).toBe(false);
	});

	it('marks an online event with OnlineEventAttendanceMode and a VirtualLocation', () => {
		const graph = eventGraph(
			[meetup('a')],
			{
				a: [
					{
						title: 'Online session',
						url: 'https://example.com/a/1',
						date: '2026-09-28T18:00:00.000Z',
						location: { online: true },
					},
				],
			},
		);
		const [event] = (graph!['@graph'] as any[]).filter((n) => n['@type'] === 'Event');
		expect(event.eventAttendanceMode).toBe(
			'https://schema.org/OnlineEventAttendanceMode',
		);
		expect(event.location).toEqual({
			'@type': 'VirtualLocation',
			url: 'https://example.com/a/1',
		});
	});

	it('includes endDate only when the source gave one, never a fabricated default', () => {
		const graph = eventGraph(
			[meetup('a')],
			{
				a: [
					{
						title: 'With end',
						url: 'https://example.com/a/1',
						date: '2026-09-28T18:00:00.000Z',
						end: '2026-09-28T20:00:00.000Z',
					},
					{
						title: 'Without end',
						url: 'https://example.com/a/2',
						date: '2026-10-05T18:00:00.000Z',
					},
				],
			},
		);
		const [withEnd, withoutEnd] = (graph!['@graph'] as any[]).filter(
			(n) => n['@type'] === 'Event',
		);
		expect(withEnd.endDate).toBe('2026-09-28T20:00:00.000Z');
		expect('endDate' in withoutEnd).toBe(false);
	});
});

describe('toJsonLdScript', () => {
	it('escapes < so a scraped value cannot close the surrounding <script> element', () => {
		const graph = eventGraph(
			[meetup('a', { name: 'Evil</script><script>alert(1)</script>' })],
			{ a: [{ title: 'Talk', url: 'https://example.com/a/1', date: '2026-09-28T18:00:00.000Z' }] },
		);
		const script = toJsonLdScript(graph);
		expect(script).not.toContain('</script>');
		expect(script).not.toContain('<script>');
		// Still round-trips to the same data once a JSON-LD consumer parses it —
		// < is a plain JSON string escape, not a lossy transformation.
		expect(JSON.parse(script)).toEqual(graph);
	});
});
