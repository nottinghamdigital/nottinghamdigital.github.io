/**
 * The categories a meetup can belong to.
 *
 * To add one: add an entry here, then add a matching
 * `--color-category-<id>` token in `src/styles/tokens.css`. No component or
 * template needs to change.
 */
export const CATEGORIES = [
	{ id: 'tech', label: 'Tech', icon: '/img/tech.svg' },
	{ id: 'design', label: 'Design', icon: '/img/design.svg' },
	{ id: 'ops', label: 'Ops', icon: '/img/ops.svg' },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]['id'];

/** Tuple of ids, for the content schema's `z.enum()`. */
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as unknown as [
	CategoryId,
	...CategoryId[],
];

export function categoryById(id: CategoryId) {
	const found = CATEGORIES.find((c) => c.id === id);
	if (!found) throw new Error(`Unknown category: ${id}`);
	return found;
}
