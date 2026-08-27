/**
 * Checks the *published* site rather than the build, and exits non-zero when
 * something is wrong. Run daily by .github/workflows/monitor.yml.
 *
 * GitHub Pages gives no server logs and nothing runs server-side, so the only
 * honest way to know the site is healthy is to fetch it and look. The checks
 * are aimed at the failure modes this site actually has:
 *
 *  - It is served at all (catches DNS, TLS and Pages misconfiguration).
 *  - The build stamp in <meta name="build-time"> is recent — the daily deploy
 *    in deploy.yml refreshes the next-event data, and a stale stamp is the only
 *    outward sign that the schedule has stopped running. GitHub disables
 *    scheduled workflows after 60 days without repo activity, silently.
 *  - Every meetup in src/content/meetups/ made it onto the page, so a broken
 *    build can't publish a half-empty directory unnoticed.
 *  - Enough groups still resolved a next event. scripts/fetch-next-events.mjs
 *    treats feed failures as non-fatal by design, so the feature can degrade to
 *    nothing while every deploy stays green. This is the check that notices.
 *
 * Usage: node scripts/check-live-site.mjs [url]
 *   SITE_URL              override the URL (default https://nottingham.digital)
 *   MIN_NEXT_EVENTS       minimum groups with an upcoming event (default 3)
 *   MAX_BUILD_AGE_HOURS   how stale the build stamp may be (default 48)
 */
import { appendFile, readdir } from 'node:fs/promises';

const SITE_URL =
	process.argv[2] ?? process.env.SITE_URL ?? 'https://nottingham.digital';
const MIN_NEXT_EVENTS = Number(process.env.MIN_NEXT_EVENTS ?? 3);
const MAX_BUILD_AGE_HOURS = Number(process.env.MAX_BUILD_AGE_HOURS ?? 48);
const MEETUPS_DIR = new URL('../src/content/meetups/', import.meta.url);
const USER_AGENT = 'nottingham.digital site monitor';

/**
 * Two retries with a short backoff. A monitor that pages on one dropped
 * connection trains everyone to ignore it; a site that is down stays down
 * across all three attempts.
 */
async function fetchSite() {
	let lastError;
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			const res = await fetch(SITE_URL, {
				headers: { 'User-Agent': USER_AGENT },
				redirect: 'follow',
			});
			if (res.status >= 500) {
				lastError = new Error(`HTTP ${res.status}`);
			} else {
				return res;
			}
		} catch (err) {
			lastError = err;
		}
		if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2000));
	}
	throw lastError;
}

/** @returns {Promise<number>} how many meetup files the site should be showing. */
async function expectedMeetupCount() {
	const files = await readdir(MEETUPS_DIR);
	return files.filter((f) => f.endsWith('.yml')).length;
}

function countMatches(html, pattern) {
	return [...html.matchAll(pattern)].length;
}

async function main() {
	const checks = [];
	const fail = (name, detail) => checks.push({ name, ok: false, detail });
	const pass = (name, detail) => checks.push({ name, ok: true, detail });

	let res;
	try {
		res = await fetchSite();
	} catch (err) {
		fail('Reachable', `${SITE_URL} → ${err.message}`);
		return report(checks);
	}

	const contentType = res.headers.get('content-type') ?? '';
	if (res.ok && contentType.includes('text/html')) {
		pass('Reachable', `HTTP ${res.status}, ${contentType.split(';')[0]}`);
	} else {
		fail('Reachable', `HTTP ${res.status}, content-type "${contentType}"`);
		return report(checks);
	}

	const html = await res.text();

	// Build freshness.
	const buildTime = html.match(
		/<meta\s+name="build-time"\s+content="([^"]+)"/i,
	)?.[1];
	const buildDate = buildTime ? new Date(buildTime) : null;
	if (!buildDate || Number.isNaN(buildDate.getTime())) {
		fail('Build freshness', 'no usable <meta name="build-time"> on the page');
	} else {
		const ageHours = (Date.now() - buildDate.getTime()) / 3_600_000;
		const detail = `built ${ageHours.toFixed(1)}h ago (${buildTime})`;
		if (ageHours > MAX_BUILD_AGE_HOURS) {
			fail(
				'Build freshness',
				`${detail} — older than ${MAX_BUILD_AGE_HOURS}h, so the daily deploy has stopped`,
			);
		} else {
			pass('Build freshness', detail);
		}
	}

	// Every meetup made it onto the page.
	const expected = await expectedMeetupCount();
	const rendered = countMatches(html, /<li[^>]*\sdata-category="/g);
	if (rendered >= expected) {
		pass('Meetups rendered', `${rendered} cards for ${expected} meetup files`);
	} else {
		fail(
			'Meetups rendered',
			`only ${rendered} cards for ${expected} meetup files`,
		);
	}

	// Next-event data still flowing.
	const withNextEvent = countMatches(html, /\sdata-next-event-date="[^"]+"/g);
	if (withNextEvent >= MIN_NEXT_EVENTS) {
		pass('Next events', `${withNextEvent} groups have an upcoming event`);
	} else {
		fail(
			'Next events',
			`only ${withNextEvent} groups have an upcoming event (expected at least ${MIN_NEXT_EVENTS}) — the feeds in scripts/fetch-next-events.mjs may have changed`,
		);
	}

	return report(checks);
}

async function report(checks) {
	const failed = checks.filter((c) => !c.ok);

	for (const check of checks) {
		console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}: ${check.detail}`);
	}

	const summaryFile = process.env.GITHUB_STEP_SUMMARY;
	if (summaryFile) {
		const lines = [
			`### ${SITE_URL}`,
			'',
			'| | Check | Detail |',
			'| --- | --- | --- |',
			...checks.map(
				(c) => `| ${c.ok ? '✅' : '❌'} | ${c.name} | ${c.detail} |`,
			),
			'',
		];
		try {
			await appendFile(summaryFile, lines.join('\n') + '\n');
		} catch (err) {
			console.warn(`could not write job summary: ${err.message}`);
		}
	}

	if (failed.length > 0) {
		console.error(
			`\n${failed.length} of ${checks.length} checks failed for ${SITE_URL}.`,
		);
		process.exitCode = 1;
	} else {
		console.log(`\nAll ${checks.length} checks passed for ${SITE_URL}.`);
	}
}

await main();
