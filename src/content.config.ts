import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';
import { CATEGORY_IDS } from './data/categories';

/**
 * One YAML file per meetup, in `src/content/meetups/`.
 *
 * Adding a group to the directory means adding a single file here — no shared
 * markup to edit, and nothing else in the site to touch.
 */
const meetups = defineCollection({
	loader: glob({ pattern: '**/*.yml', base: './src/content/meetups' }),
	schema: z.object({
		/** Display name, also used for the alphabetical sort. */
		name: z.string().min(1),
		/** Where to find the group: Meetup, its own site, wherever it lives. */
		url: z.string().url(),
		/**
		 * Where the group's upcoming events actually live — read by
		 * scripts/fetch-next-events.mjs. Often the same as `url`; only differs
		 * when the group's site and its events feed are different pages (e.g.
		 * a Luma calendar, a Meetup group, an `/events` subpage).
		 */
		events: z.string().url().optional(),
		/** A sentence or two, written by the organisers. */
		summary: z.string().min(1),
		/** A short callout that needs to stand out from the summary, e.g. a venue change or booking requirement. */
		notes: z.string().min(1).optional(),
		/** How often it runs, in plain English: "Second Thursday". */
		cadence: z.string().min(1),
		category: z.enum(CATEGORY_IDS),
		/**
		 * Optional social/extra links. An array rather than a fixed `twitter`
		 * field so a group can list Bluesky, Mastodon or LinkedIn without a
		 * schema change.
		 */
		links: z
			.array(
				z.object({
					label: z.string().min(1),
					url: z.string().url(),
				}),
			)
			.default([]),
	}),
});

export const collections = { meetups };
