# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`nottingham.digital` — a static directory of Nottingham tech meetups, built with
Astro and deployed to GitHub Pages. No server, no client-side framework: the
meetup list is rendered to plain HTML at build time. The only client JS is the
inline `<script>` in `CategoryFilters.astro`.

Requires Node.js >= 20.3 (CI runs 22).

## Commands

```sh
npm run dev      # dev server at http://localhost:4321
npm run build    # static output into dist/ — also validates every meetup YAML file
npm run check    # astro check: type-check components and content
npm test         # Playwright — webServer builds the site and serves dist/
npm run test:ui  # Playwright UI mode
```

The tests run against the **built** site, not the dev server: Playwright's
`webServer` runs `npm run build && node scripts/serve-dist.mjs`. Both `astro
dev` and `astro preview` daemonise and return immediately, which Playwright
reports as "webServer exited early" — so neither can be used there.

Single test / single file:

```sh
npx playwright test tests/homepage.spec.ts
npx playwright test -g 'filtering meetups by category works'
```

`npm run build` is the de-facto lint: the content schema rejects malformed
meetup files, so run it before opening a PR (contributor-guide.md requires it).

## Architecture

The site's design goal is that **contributing a meetup means adding one file and
touching nothing else**, and **rebranding means editing one CSS file and one
component**. Preserve both properties when changing things.

**Content pipeline.** `src/content/meetups/*.yml` (one file per group) → loaded by
the `glob` loader in `src/content.config.ts` → validated against a Zod schema →
`getCollection('meetups')` in `src/pages/index.astro`, sorted alphabetically by
`name` with `en-GB` collation → one `MeetupCard` per entry. There is no CMS, no
fetch, no runtime data source.

**Categories are the one cross-cutting concept.** `src/data/categories.ts` is the
single list; `CATEGORY_IDS` feeds the schema's `z.enum()`, so an unknown category
in a YAML file fails the build. Adding a category requires three coordinated
edits and nothing else:

1. an entry in `src/data/categories.ts`
2. a matching `--color-category-<id>` token in `src/styles/tokens.css`
3. an icon at the `icon` path (`public/img/<id>.svg`)

Components derive their accent from the id via `var(--color-category-${id})` in an
inline `style`, so no component or page markup changes.

**The logo** is `src/assets/nd-monogram.svg`, imported as an Astro SVG component
by `Logo.astro` so it inlines into the page. Its two fills read `--logo-ink` and
`--logo-accent`, which `.site-mark` maps onto the brand tokens — so it recolours
per theme instead of shipping a second palette. It is `aria-hidden`; the heading
beneath already names the site.

**Styling.** `src/styles/tokens.css` holds *every* colour, font, space and radius,
including the `prefers-color-scheme: dark` block; no other stylesheet contains a
raw colour value. `global.css` imports tokens + print styles and holds all layout.
Keep new colour values in tokens.css rather than inlining them.

**Filtering** is progressive-enhancement: `BaseLayout` adds a `js` class to
`<html>` inline, `.filters` is hidden without it, and the script toggles the
`hidden` attribute on `[data-category]` cards while updating `aria-pressed` and a
`role="status"` live region. Cards are always in the DOM.

**Accessibility is load-bearing in the tokens file.** `--color-on-accent` is dark
ink because white fails AA against the red accent — re-check contrast if the
accent colours change. Cards carry h-card microformat classes (`h-card`, `p-name`,
`u-url`, `p-summary`); keep them when editing `MeetupCard.astro`.

## Deployment and CI

- `.github/workflows/ci.yml` on PRs: `npm ci` + `npm run build`, then asserts
  `dist/CNAME` exists and reads `nottingham.digital`.
- `.github/workflows/deploy.yml` on push to `main`: builds and publishes `dist/`
  to GitHub Pages. Repo Settings → Pages → Source must be **GitHub Actions**.
- `public/CNAME` is the one that ships (public/ is copied into dist/). The root
  `CNAME` is a leftover from when Pages served the branch root directly.
- `astro.config.mjs` pins `build.format: 'directory'` — do not switch to `file`
  format, it breaks the apex-domain URLs.
- `.github/workflows/ci.yml` also runs the Playwright suite on PRs, installing
  chromium only, and uploads `playwright-report/` as an artifact when it fails.
- `playwright-report/` and `test-results/` are tracked in git rather than
  ignored, so a local test run leaves them dirty and can block `git stash pop`
  or a rebase. `npm run check` is deliberately not in CI: it currently reports
  4 pre-existing errors from the deprecated `z.string().url()` in the content
  schema.

## Contribution rules that affect edits

From `contributor-guide.md`: meetup titles link to the group's site or Meetup
page; summaries are short and scannable; groups must be in Nottingham or the
immediate area. `links` is an open array of `label`/`url` pairs (rather than fixed
`twitter`/`mastodon` fields) so a group can add any platform without a schema
change.

Longer-form implementation notes live in `.claude/plans/` — read the relevant one
before large changes to the build or the content set.
