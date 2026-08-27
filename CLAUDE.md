# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`nottingham.digital` — a static directory of Nottingham tech meetups, built with
Astro and deployed to GitHub Pages. No server, no client-side framework: the
meetup list is rendered to plain HTML at build time. Client JS is limited to
small inline `<script>`s: category filtering in `CategoryFilters.astro`, the
light/dark/auto control in `ThemeToggle.astro`, and the pre-paint setup
(`js` class, stored theme) in `BaseLayout.astro`.

Requires Node.js >= 20.3 (CI runs 22).

## Commands

```sh
npm run dev      # dev server at http://localhost:4321
npm run build    # static output into dist/ — also validates every meetup YAML file
npm run check    # astro check: type-check components and content
npm test         # Playwright — webServer builds the site and serves dist/
npm run test:ui  # Playwright UI mode
npm run lighthouse  # Lighthouse budgets against the built site (needs Chrome)
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

**Styling.** `src/styles/tokens.css` holds *every* colour, font, space and radius;
no other stylesheet contains a raw colour value. `global.css` imports tokens +
print styles and holds all layout. Keep new colour values in tokens.css rather
than inlining them.

**Dark mode** values live once, in `--dark-*` variables on `:root` in
tokens.css. Two rules point the real tokens at them — `@media
(prefers-color-scheme: dark)` for visitors who haven't chosen, and
`[data-theme="dark"]` for an explicit choice made via the footer toggle
(`ThemeToggle.astro`) — because a media feature can't be OR'd with an
attribute selector in one CSS rule. The media-query block is guarded with
`:not([data-theme="light"])` so it can't override an explicit "light" choice
made while the OS is dark. Change the palette in the `--dark-*` block only;
the two consuming rules don't need touching.

**Filtering and the theme toggle** are both progressive-enhancement:
`BaseLayout` adds a `js` class to `<html>` inline, `.filters` and
`.theme-toggle` are hidden without it, and each script toggles state while
updating `aria-pressed` and a `role="status"` live region. Meetup cards are
always in the DOM; the theme toggle additionally has `BaseLayout` apply any
stored `nd-theme` localStorage value to `<html data-theme>` before first
paint, so there's no flash of the wrong theme.

**Analytics and monitoring are deliberately thin.** `src/data/analytics.ts`
holds the GoatCounter endpoint and nothing else; `BaseLayout` renders the beacon
only when that string is non-empty (so a fork opts out by emptying it) and
renders it last in `<body>`, async, so it cannot affect first paint. GoatCounter
is cookieless and stores nothing on the device — the footer says so, and
`tests/homepage.spec.ts` asserts no cookies are set, which is what keeps that
claim honest if the analytics ever change. `count.js` refuses to send from
localhost, so `astro dev` and the Playwright suite never reach the live stats.
The one open item is that `count.js` is loaded from `gc.zgo.at`, so that origin
can execute script on the site; SRI can't pin a vendor-updated file, but
GoatCounter supports serving your own copy (drop it in `public/`, keep the
`data-goatcounter` attribute — the `/count` endpoint is guaranteed compatible),
which would leave only a POST that cannot execute anything.

`BaseLayout` also stamps `<meta name="build-time">` into every page. That is a
contract with `scripts/check-live-site.mjs`, which fetches the *published* site
daily from `.github/workflows/monitor.yml` and fails when the site is
unreachable, the stamp is over 48h old, fewer cards are published than there
are meetup files, or almost no group resolved an upcoming event. That last check
exists because `scripts/fetch-next-events.mjs` treats feed failures as
non-fatal by design, so the next-event feature can degrade to nothing while
every deploy stays green. Keep the meta tag and the `data-category` /
`data-next-event-date` attributes on `MeetupCard` — the monitor greps for them.

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
- `.github/workflows/ci.yml` has a third job running Lighthouse via
  `treosh/lighthouse-ci-action` against the built site, configured by
  `lighthouserc.json`. The job carries `continue-on-error: true` because the
  thresholds there (accessibility and SEO 1, best-practices 0.95, performance
  a warning) have never been measured against this site — read the real
  scores off the `lighthouse-report` artifact, set the thresholds from them,
  and drop `continue-on-error` to make the budgets binding. Lighthouse CI is
  deliberately
  *not* a devDependency: `@lhci/cli` drags in a puppeteer tree and ~10 audit
  advisories for a five-dependency repo, so the action supplies it in CI and
  `npm run lighthouse` shells out to `npx` locally.
- `.github/workflows/monitor.yml` runs `scripts/check-live-site.mjs` daily at
  07:30 UTC, 90 minutes after the deploy cron. A red run is the alert channel:
  GitHub emails the workflow file's last committer when a scheduled run fails,
  so there is no external monitoring account or secret. Caveat: this workflow's
  own cron is subject to the same 60-day inactivity auto-disable as the deploy
  cron.
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
