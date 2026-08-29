// Applies a "suggest an edit" issue (see .github/ISSUE_TEMPLATE/suggest-edit.yml)
// to the matching meetup YAML file. Run by .github/workflows/process-suggestion.yml
// with the raw issue body on stdin — never invoked directly by a contributor.
//
// GitHub renders each issue-form field as a `### <label>` heading followed by
// the answer (or `_No response_` for a field left blank), so the body is
// parsed by matching those headings against the form's field labels.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { parseDocument, stringify } from 'yaml';

const MEETUPS_DIR = new URL('../src/content/meetups/', import.meta.url);
const CATEGORIES_FILE = new URL('../src/data/categories.ts', import.meta.url);

export function parseIssueBody(body) {
	const fields = {};
	const headingPattern = /^### (.+)$/gm;
	const matches = [...body.matchAll(headingPattern)];
	for (let i = 0; i < matches.length; i++) {
		const label = matches[i][1].trim();
		const start = matches[i].index + matches[i][0].length;
		const end = i + 1 < matches.length ? matches[i + 1].index : body.length;
		const value = body.slice(start, end).trim();
		fields[label] = value === '_No response_' ? '' : value;
	}
	return fields;
}

/** Reads the valid category ids straight from the single source of truth. */
export async function loadCategoryIds() {
	const source = await readFile(CATEGORIES_FILE, 'utf-8');
	return [...source.matchAll(/id:\s*'([a-z-]+)'/g)].map((m) => m[1]);
}

export function parseLinks(text) {
	const links = [];
	for (const rawLine of text.split('\n')) {
		const line = rawLine.trim();
		if (!line) continue;
		const colonIndex = line.indexOf(':');
		if (colonIndex === -1) {
			throw new Error(`Link line isn't in "Label: URL" form: "${line}"`);
		}
		const label = line.slice(0, colonIndex).trim();
		const url = line.slice(colonIndex + 1).trim();
		if (!label || !url) {
			throw new Error(`Link line isn't in "Label: URL" form: "${line}"`);
		}
		links.push({ label, url });
	}
	return links;
}

/**
 * Renders just the "value" portion of `key: value` the way yaml would write
 * it — same relative indentation yaml uses for a top-level key — so it can
 * be spliced directly into another top-level key's value range below.
 */
export function serializeFieldValue(key, value) {
	const text = stringify({ [key]: value }, { lineWidth: 79 });
	const pair = parseDocument(text).contents.items[0];
	const [start, valueEnd] = pair.value.range;
	return text.slice(start, valueEnd);
}

/**
 * Replaces a single top-level field's value in raw YAML text, preserving
 * every other line byte-for-byte. Re-serialising the whole document with
 * the `yaml` package would otherwise reflow every multi-line scalar in the
 * file to its own line width — since these files are hand-wrapped rather
 * than wrapped to any width the library would reproduce, that turns an edit
 * to one field into spurious diff noise across every other field.
 */
export function setField(raw, key, value) {
	const pair = parseDocument(raw).contents.items.find(
		(p) => p.key.value === key,
	);
	const newValue = serializeFieldValue(key, value);
	if (!pair) {
		const eol = raw.includes('\r\n') ? '\r\n' : '\n';
		const separator = raw.endsWith(eol) ? '' : eol;
		return `${raw}${separator}${key}: ${newValue}${eol}`;
	}
	const [start, valueEnd] = pair.value.range;
	return raw.slice(0, start) + newValue + raw.slice(valueEnd);
}

export async function findMeetupFile(groupName, meetupsDir = MEETUPS_DIR) {
	const files = (await readdir(meetupsDir)).filter((f) => f.endsWith('.yml'));
	for (const file of files) {
		const url = new URL(file, meetupsDir);
		const raw = await readFile(url, 'utf-8');
		const doc = parseDocument(raw);
		const name = doc.get('name');
		if (typeof name === 'string' && name.trim().toLowerCase() === groupName.trim().toLowerCase()) {
			return { url, raw };
		}
	}
	return null;
}

/**
 * Pure transform: given an issue body and the source of truth for the
 * meetup dir and category ids, works out the target file and returns the
 * patched YAML text. Doesn't touch the filesystem for writes — the CLI
 * `main()` does that, tests just assert against `newRaw`.
 */
export async function applySuggestion({ body, meetupsDir = MEETUPS_DIR, categoryIds }) {
	const fields = parseIssueBody(body);
	const groupName = fields['Which group is this for?']?.trim();
	if (!groupName) {
		throw new Error('No group name found in the issue body.');
	}

	const match = await findMeetupFile(groupName, meetupsDir);
	if (!match) {
		throw new Error(
			`No meetup file found with name "${groupName}" — it must match exactly as shown on the site.`,
		);
	}
	let { url, raw } = match;
	let finalName = groupName;

	if (fields['New group name']) {
		finalName = fields['New group name'];
		raw = setField(raw, 'name', finalName);
	}
	if (fields['New URL']) raw = setField(raw, 'url', fields['New URL']);
	if (fields['New events URL']) {
		raw = setField(raw, 'events', fields['New events URL']);
	}
	if (fields['New cadence']) raw = setField(raw, 'cadence', fields['New cadence']);
	if (fields['New summary']) raw = setField(raw, 'summary', fields['New summary']);
	if (fields['New notes']) raw = setField(raw, 'notes', fields['New notes']);

	// GitHub's dropdown widget shows "None" as its button caption until a
	// person actually opens it and clicks an option — if someone submits
	// without touching it, the answer can come through as the literal text
	// "None" rather than our "— leave unchanged —" default, so both count as
	// no change here.
	const categoryLabel = fields['New category'];
	if (
		categoryLabel &&
		categoryLabel !== '— leave unchanged —' &&
		categoryLabel !== 'None'
	) {
		const id = categoryLabel.toLowerCase();
		const validIds = categoryIds ?? (await loadCategoryIds());
		if (!validIds.includes(id)) {
			throw new Error(`Unknown category "${categoryLabel}".`);
		}
		raw = setField(raw, 'category', id);
	}

	if (fields['Links to add']) {
		raw = setField(raw, 'links', parseLinks(fields['Links to add']));
	}

	const filePath = `src/content/meetups/${decodeURIComponent(url.pathname.split('/').pop())}`;
	return { finalName, filePath, newRaw: raw, url };
}

async function main() {
	const body = await new Promise((resolve, reject) => {
		let data = '';
		process.stdin.setEncoding('utf-8');
		process.stdin.on('data', (chunk) => (data += chunk));
		process.stdin.on('end', () => resolve(data));
		process.stdin.on('error', reject);
	});

	const meetupsDirOverride = process.env.MEETUPS_DIR
		? new URL(`file://${process.env.MEETUPS_DIR}/`)
		: undefined;
	const { finalName, filePath, newRaw, url } = await applySuggestion({
		body,
		...(meetupsDirOverride && { meetupsDir: meetupsDirOverride }),
	});
	await writeFile(url, newRaw);

	// Sets these as step outputs (steps.apply.outputs.*) for the workflow —
	// plain console.log doesn't do this in modern Actions; it has to be
	// written to the file at $GITHUB_OUTPUT.
	const githubOutput = process.env.GITHUB_OUTPUT;
	if (githubOutput) {
		await writeFile(githubOutput, `group-name=${finalName}\nfile-path=${filePath}\n`, {
			flag: 'a',
		});
	}
	console.log(`group-name=${finalName}`);
	console.log(`file-path=${filePath}`);
}

// Only run main() when invoked as a script, not when imported by a test.
const invokedAsScript =
	process.argv[1] &&
	import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/'));

if (invokedAsScript) {
	await main();
}
