import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

// Pins the three-way contract between:
//   1. .github/ISSUE_TEMPLATE/suggest-edit.yml (the form GitHub renders)
//   2. src/components/EditPanelScript.astro   (the client that pre-fills it)
//   3. scripts/apply-suggestion.mjs           (the workflow that parses it)
// A rename or field removal in any one breaks the whole flow silently, so
// asserting the seams here catches the drift before a real contributor hits it.

const TEMPLATE_URL = new URL(
	'../../.github/ISSUE_TEMPLATE/suggest-edit.yml',
	import.meta.url,
);
const EDIT_PANEL_SCRIPT_URL = new URL(
	'../../src/components/EditPanelScript.astro',
	import.meta.url,
);
const APPLY_SCRIPT_URL = new URL(
	'../../scripts/apply-suggestion.mjs',
	import.meta.url,
);
const CATEGORIES_URL = new URL(
	'../../src/data/categories.ts',
	import.meta.url,
);
const WORKFLOW_URL = new URL(
	'../../.github/workflows/process-suggestion.yml',
	import.meta.url,
);

// Every label the server-side script looks up in the parsed issue body. If a
// new field is added on the server side, list it here too — the test will
// then fail until the template has a matching label.
const APPLY_SCRIPT_LABELS = [
	'Which group is this for?',
	'New group name',
	'New URL',
	'New events URL',
	'New cadence',
	'New summary',
	'New notes',
	'New category',
	'Links to add',
];

// Every field id the client-side script reads out of the form (via
// EditPanelScript.astro's `fieldToParam` map, keyed by the id GitHub uses in
// the issue-form URL query string).
const CLIENT_FIELD_IDS = [
	'group-name',
	'new-name',
	'new-url',
	'new-events',
	'new-cadence',
	'new-summary',
	'new-notes',
	'new-category',
	'new-links',
];

interface TemplateField {
	type: string;
	id?: string;
	attributes?: {
		label?: string;
		options?: string[];
	};
}

interface Template {
	title: string;
	labels: string[];
	body: TemplateField[];
}

describe('suggest-edit issue template ↔ client script ↔ apply-suggestion contract', () => {
	let template: Template;
	let templateFieldsById: Map<string, TemplateField>;
	let templateFieldsByLabel: Map<string, TemplateField>;

	beforeAll(async () => {
		template = parse(await readFile(TEMPLATE_URL, 'utf-8'));
		templateFieldsById = new Map();
		templateFieldsByLabel = new Map();
		for (const field of template.body) {
			if (field.id) templateFieldsById.set(field.id, field);
			if (field.attributes?.label) {
				templateFieldsByLabel.set(field.attributes.label, field);
			}
		}
	});

	it('every field id the client script reads exists in the template', () => {
		for (const id of CLIENT_FIELD_IDS) {
			expect(
				templateFieldsById.has(id),
				`template is missing field id "${id}" (referenced by EditPanelScript.astro)`,
			).toBe(true);
		}
	});

	it('every label the apply-suggestion script looks up exists in the template', () => {
		for (const label of APPLY_SCRIPT_LABELS) {
			expect(
				templateFieldsByLabel.has(label),
				`template is missing field label "${label}" (referenced by apply-suggestion.mjs)`,
			).toBe(true);
		}
	});

	it('the client fieldToParam map in EditPanelScript.astro still targets those ids', async () => {
		const script = await readFile(EDIT_PANEL_SCRIPT_URL, 'utf-8');
		// Match `key: 'value'` inside the fieldToParam object. Values are the
		// query-string ids we care about (`group-name` is set separately as a
		// URLSearchParams init, so check it too).
		const paramValues = [...script.matchAll(/['"]new-[a-z]+['"]/g)].map((m) =>
			m[0].slice(1, -1),
		);
		expect(new Set(paramValues)).toEqual(
			new Set(CLIENT_FIELD_IDS.filter((id) => id.startsWith('new-'))),
		);
		expect(script).toContain("'group-name'");
	});

	it('the new-category dropdown options map cleanly to CATEGORY_IDS (lowercased)', async () => {
		const categoryField = templateFieldsById.get('new-category');
		expect(categoryField?.type).toBe('dropdown');
		const options = categoryField?.attributes?.options ?? [];
		// First option is the sentinel — everything else must map to a real id.
		expect(options[0]).toBe('— leave unchanged —');

		const categoriesSource = await readFile(CATEGORIES_URL, 'utf-8');
		const categoryIds = [
			...categoriesSource.matchAll(/id:\s*'([a-z-]+)'/g),
		].map((m) => m[1]);
		for (const opt of options.slice(1)) {
			expect(
				categoryIds.includes(opt.toLowerCase()),
				`category option "${opt}" has no matching id in src/data/categories.ts`,
			).toBe(true);
		}
	});

	it('the template title prefix matches the workflow filter — pins the "trigger on title not label" regression', async () => {
		expect(template.title).toBe('[Edit suggestion]: ');
		const workflow = await readFile(WORKFLOW_URL, 'utf-8');
		expect(workflow).toContain("startsWith(github.event.issue.title, '[Edit suggestion]:')");
	});

	it('the apply-suggestion script really does reference every label we claim it does', async () => {
		const source = await readFile(APPLY_SCRIPT_URL, 'utf-8');
		for (const label of APPLY_SCRIPT_LABELS) {
			expect(
				source.includes(label),
				`apply-suggestion.mjs no longer references label "${label}" — either add it back or remove from the contract test`,
			).toBe(true);
		}
	});
});
