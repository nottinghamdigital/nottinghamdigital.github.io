import { describe, it, expect } from 'vitest';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	parseIssueBody,
	parseLinks,
	setField,
	applySuggestion,
} from '../../scripts/apply-suggestion.mjs';

const REPO_MEETUPS_DIR = new URL(
	'../../src/content/meetups/',
	import.meta.url,
);

async function tmpMeetupsDir(files: Record<string, string>) {
	const dir = await mkdtemp(join(tmpdir(), 'apply-suggestion-'));
	for (const [name, content] of Object.entries(files)) {
		await writeFile(join(dir, name), content);
	}
	return pathToFileURL(dir + '/');
}

describe('parseIssueBody', () => {
	it('extracts ### Label sections into a { label: value } map', () => {
		const body = [
			'### Which group is this for?',
			'',
			'Nottingham Programmers',
			'',
			'### New cadence',
			'',
			'Weekly on Fridays',
		].join('\n');
		expect(parseIssueBody(body)).toEqual({
			'Which group is this for?': 'Nottingham Programmers',
			'New cadence': 'Weekly on Fridays',
		});
	});

	it('converts _No response_ to empty string', () => {
		const body = ['### New notes', '', '_No response_'].join('\n');
		expect(parseIssueBody(body)).toEqual({ 'New notes': '' });
	});

	it('preserves multi-line values including blank lines between paragraphs', () => {
		const body = [
			'### New summary',
			'',
			'First paragraph.',
			'',
			'Second paragraph.',
			'',
			'### New notes',
			'',
			'A note.',
		].join('\n');
		const fields = parseIssueBody(body);
		expect(fields['New summary']).toBe('First paragraph.\n\nSecond paragraph.');
		expect(fields['New notes']).toBe('A note.');
	});

	it('trims outer whitespace but not internal', () => {
		const body = ['### Field', '', '  spaced   value  '].join('\n');
		expect(parseIssueBody(body)).toEqual({ Field: 'spaced   value' });
	});
});

describe('parseLinks', () => {
	it('parses Label: URL lines into { label, url }[]', () => {
		const text = 'LinkedIn: https://linkedin.com/company/x\nX: https://x.com/x';
		expect(parseLinks(text)).toEqual([
			{ label: 'LinkedIn', url: 'https://linkedin.com/company/x' },
			{ label: 'X', url: 'https://x.com/x' },
		]);
	});

	it('splits on the first colon so URLs keep their scheme intact', () => {
		expect(parseLinks('Site: https://example.com/x?q=1:2')).toEqual([
			{ label: 'Site', url: 'https://example.com/x?q=1:2' },
		]);
	});

	it('skips blank lines', () => {
		expect(parseLinks('\nX: https://x.com/x\n\n\n')).toEqual([
			{ label: 'X', url: 'https://x.com/x' },
		]);
	});

	it('throws on a line without a colon', () => {
		expect(() => parseLinks('no colon here')).toThrow(/Label: URL/);
	});

	it('throws on a line with an empty label', () => {
		expect(() => parseLinks(': https://example.com')).toThrow(/Label: URL/);
	});

	it('throws on a line with an empty URL', () => {
		expect(() => parseLinks('Label:')).toThrow(/Label: URL/);
	});
});

describe('setField', () => {
	it('replaces an existing top-level scalar without touching other lines', () => {
		const before = [
			'name: X',
			'url: https://example.com',
			'category: tech',
			'',
		].join('\n');
		const after = setField(before, 'category', 'design');
		expect(after).toBe(
			['name: X', 'url: https://example.com', 'category: design', ''].join('\n'),
		);
	});

	it('replaces a folded multi-line scalar without reflowing sibling fields', async () => {
		const before = await readFile(
			new URL('nottingham-programmers.yml', REPO_MEETUPS_DIR),
			'utf-8',
		);
		const after = setField(before, 'cadence', 'Weekly on Fridays');
		// Every line except the cadence: line should be byte-identical.
		const beforeLines = before.split('\n');
		const afterLines = after.split('\n');
		expect(afterLines).toHaveLength(beforeLines.length);
		for (let i = 0; i < beforeLines.length; i++) {
			if (beforeLines[i].startsWith('cadence:')) {
				expect(afterLines[i]).toBe('cadence: Weekly on Fridays');
			} else {
				expect(afterLines[i]).toBe(beforeLines[i]);
			}
		}
	});

	it('appends a new key when it does not exist, using the file EOL', () => {
		const lf = 'name: X\nurl: https://example.com\n';
		expect(setField(lf, 'notes', 'A note')).toBe(
			'name: X\nurl: https://example.com\nnotes: A note\n',
		);

		const crlf = 'name: X\r\nurl: https://example.com\r\n';
		expect(setField(crlf, 'notes', 'A note')).toBe(
			'name: X\r\nurl: https://example.com\r\nnotes: A note\r\n',
		);
	});
});

describe('applySuggestion (parse + patch, no disk write)', () => {
	const CATEGORY_IDS = ['tech', 'design', 'ops'];

	async function withDotNetNotts() {
		const raw = await readFile(
			new URL('dot-net-notts.yml', REPO_MEETUPS_DIR),
			'utf-8',
		);
		const meetupsDir = await tmpMeetupsDir({ 'dot-net-notts.yml': raw });
		return { meetupsDir, raw };
	}

	it('looks up the meetup by name case-insensitively and trimmed', async () => {
		const { meetupsDir } = await withDotNetNotts();
		const body = '### Which group is this for?\n\n  .net notts  ';
		const result = await applySuggestion({
			body,
			meetupsDir,
			categoryIds: CATEGORY_IDS,
		});
		expect(result.finalName).toBe('.net notts');
		expect(result.filePath).toBe('src/content/meetups/dot-net-notts.yml');
	});

	it('throws with a helpful message on an unknown group', async () => {
		const { meetupsDir } = await withDotNetNotts();
		const body = '### Which group is this for?\n\nNot a real group';
		await expect(
			applySuggestion({ body, meetupsDir, categoryIds: CATEGORY_IDS }),
		).rejects.toThrow(/No meetup file found with name "Not a real group"/);
	});

	it('throws when the group name field is missing entirely', async () => {
		const { meetupsDir } = await withDotNetNotts();
		await expect(
			applySuggestion({ body: '### New cadence\n\nWeekly', meetupsDir, categoryIds: CATEGORY_IDS }),
		).rejects.toThrow(/No group name/);
	});

	it('leaves every other byte identical when only one field changes — pins the "stop reflowing untouched fields" regression', async () => {
		const { meetupsDir, raw } = await withDotNetNotts();
		const body = [
			'### Which group is this for?',
			'',
			'.NET Notts',
			'',
			'### New cadence',
			'',
			'First Wednesday of the month',
		].join('\n');
		const { newRaw } = await applySuggestion({
			body,
			meetupsDir,
			categoryIds: CATEGORY_IDS,
		});

		const before = raw.split('\n');
		const after = newRaw.split('\n');
		expect(after).toHaveLength(before.length);
		for (let i = 0; i < before.length; i++) {
			if (before[i].startsWith('cadence:')) {
				expect(after[i]).toBe('cadence: First Wednesday of the month');
			} else {
				expect(after[i]).toBe(before[i]);
			}
		}
	});

	it('treats "None" as no-change for the category dropdown — pins the GitHub dropdown quirk regression', async () => {
		const { meetupsDir, raw } = await withDotNetNotts();
		const body = [
			'### Which group is this for?',
			'',
			'.NET Notts',
			'',
			'### New category',
			'',
			'None',
		].join('\n');
		const { newRaw } = await applySuggestion({
			body,
			meetupsDir,
			categoryIds: CATEGORY_IDS,
		});
		expect(newRaw).toBe(raw);
	});

	it('treats "— leave unchanged —" as no-change for the category dropdown', async () => {
		const { meetupsDir, raw } = await withDotNetNotts();
		const body = [
			'### Which group is this for?',
			'',
			'.NET Notts',
			'',
			'### New category',
			'',
			'— leave unchanged —',
		].join('\n');
		const { newRaw } = await applySuggestion({
			body,
			meetupsDir,
			categoryIds: CATEGORY_IDS,
		});
		expect(newRaw).toBe(raw);
	});

	it('lowercases a chosen category label into a valid id', async () => {
		const { meetupsDir } = await withDotNetNotts();
		const body = [
			'### Which group is this for?',
			'',
			'.NET Notts',
			'',
			'### New category',
			'',
			'Design',
		].join('\n');
		const { newRaw } = await applySuggestion({
			body,
			meetupsDir,
			categoryIds: CATEGORY_IDS,
		});
		expect(newRaw).toContain('category: design');
	});

	it('throws when the chosen category is unknown', async () => {
		const { meetupsDir } = await withDotNetNotts();
		const body = [
			'### Which group is this for?',
			'',
			'.NET Notts',
			'',
			'### New category',
			'',
			'Cheese',
		].join('\n');
		await expect(
			applySuggestion({ body, meetupsDir, categoryIds: CATEGORY_IDS }),
		).rejects.toThrow(/Unknown category "Cheese"/);
	});

	it('replaces the existing links list (does not append)', async () => {
		const { meetupsDir } = await withDotNetNotts();
		const body = [
			'### Which group is this for?',
			'',
			'.NET Notts',
			'',
			'### Links to add',
			'',
			'Mastodon: https://mastodon.social/@dotnetnotts',
		].join('\n');
		const { newRaw } = await applySuggestion({
			body,
			meetupsDir,
			categoryIds: CATEGORY_IDS,
		});
		expect(newRaw).toContain('Mastodon');
		expect(newRaw).toContain('mastodon.social/@dotnetnotts');
		expect(newRaw).not.toContain('linkedin.com/company/dotnet-notts');
		expect(newRaw).not.toContain('x.com/dotnetnotts');
	});

	it('rewrites the name and returns finalName when a new group name is supplied', async () => {
		const { meetupsDir } = await withDotNetNotts();
		const body = [
			'### Which group is this for?',
			'',
			'.NET Notts',
			'',
			'### New group name',
			'',
			'.NET Nottingham',
		].join('\n');
		const { finalName, newRaw } = await applySuggestion({
			body,
			meetupsDir,
			categoryIds: CATEGORY_IDS,
		});
		expect(finalName).toBe('.NET Nottingham');
		expect(newRaw).toContain('name: .NET Nottingham');
	});
});
