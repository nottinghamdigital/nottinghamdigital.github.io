// Applies a "suggest an edit" issue (see .github/ISSUE_TEMPLATE/suggest-edit.yml)
// to the matching meetup YAML file. Run by .github/workflows/process-suggestion.yml
// with the raw issue body on stdin — never invoked directly by a contributor.
//
// GitHub renders each issue-form field as a `### <label>` heading followed by
// the answer (or `_No response_` for a field left blank), so the body is
// parsed by matching those headings against the form's field labels.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { parseDocument } from 'yaml';

const MEETUPS_DIR = new URL('../src/content/meetups/', import.meta.url);
const CATEGORIES_FILE = new URL('../src/data/categories.ts', import.meta.url);

function parseIssueBody(body) {
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
async function loadCategoryIds() {
	const source = await readFile(CATEGORIES_FILE, 'utf-8');
	return [...source.matchAll(/id:\s*'([a-z-]+)'/g)].map((m) => m[1]);
}

function parseLinks(text) {
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

async function findMeetupFile(groupName) {
	const files = (await readdir(MEETUPS_DIR)).filter((f) => f.endsWith('.yml'));
	for (const file of files) {
		const url = new URL(file, MEETUPS_DIR);
		const raw = await readFile(url, 'utf-8');
		const doc = parseDocument(raw);
		const name = doc.get('name');
		if (typeof name === 'string' && name.trim().toLowerCase() === groupName.trim().toLowerCase()) {
			return { url, raw, doc };
		}
	}
	return null;
}

async function main() {
	const body = await new Promise((resolve, reject) => {
		let data = '';
		process.stdin.setEncoding('utf-8');
		process.stdin.on('data', (chunk) => (data += chunk));
		process.stdin.on('end', () => resolve(data));
		process.stdin.on('error', reject);
	});

	const fields = parseIssueBody(body);
	const groupName = fields['Which group is this for?']?.trim();
	if (!groupName) {
		throw new Error('No group name found in the issue body.');
	}

	const match = await findMeetupFile(groupName);
	if (!match) {
		throw new Error(
			`No meetup file found with name "${groupName}" — it must match exactly as shown on the site.`,
		);
	}
	const { url, doc } = match;

	if (fields['New group name']) doc.set('name', fields['New group name']);
	if (fields['New URL']) doc.set('url', fields['New URL']);
	if (fields['New cadence']) doc.set('cadence', fields['New cadence']);
	if (fields['New summary']) doc.set('summary', fields['New summary']);

	const categoryLabel = fields['New category'];
	if (categoryLabel && categoryLabel !== '— leave unchanged —') {
		const id = categoryLabel.toLowerCase();
		const validIds = await loadCategoryIds();
		if (!validIds.includes(id)) {
			throw new Error(`Unknown category "${categoryLabel}".`);
		}
		doc.set('category', id);
	}

	if (fields['Links to add']) {
		doc.set('links', parseLinks(fields['Links to add']));
	}

	await writeFile(url, String(doc));

	const finalName = doc.get('name');
	console.log(`group-name=${finalName}`);
	console.log(`file-path=src/content/meetups/${decodeURIComponent(url.pathname.split('/').pop())}`);
}

await main();
