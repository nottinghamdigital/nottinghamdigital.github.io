/**
 * Reads `src/data/next-events.generated.json`, written by
 * `scripts/fetch-next-events.mjs` before the build. Shared by
 * `src/pages/index.astro` and `src/pages/calendar/[event].ics.ts` so both
 * consume the exact same data through the exact same fallback, rather than
 * two inlined reads that could disagree about what "no data yet" means.
 *
 * The file is gitignored and may not exist — `astro dev` without a prior
 * build, or a fresh checkout — so a missing or unparsable file resolves to
 * `{}` rather than throwing, and every card falls back to its static
 * cadence text. Consistent with the rest of this script: a feed failure is
 * never fatal to the build.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * @typedef {import('./calendar-links.mjs').NextEvent} NextEvent
 */

const NEXT_EVENTS_PATH = path.join(
	process.cwd(),
	'src/data/next-events.generated.json',
);

/**
 * @returns {Promise<Record<string, NextEvent[]>>} Keyed by meetup
 *   content-collection id (the YAML filename stem).
 */
export async function loadNextEvents() {
	return readFile(NEXT_EVENTS_PATH, 'utf-8')
		.then((raw) => JSON.parse(raw))
		.catch(() => ({}));
}
