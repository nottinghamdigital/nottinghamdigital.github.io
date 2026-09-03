# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`nottingham.digital` — a static directory of Nottingham tech meetups, built with
Astro and deployed to GitHub Pages. No server, no client-side framework: the
meetup list is rendered to plain HTML at build time. Client JS is limited to
small inline `<script>`s: category filtering in `CategoryFilters.astro`, the
light/dark/auto control in `ThemeToggle.astro`, the pre-paint setup (`js`
class, stored theme) in `BaseLayout.astro`, and the edit-mode pair
(`EditModeToggle.astro` + `EditPanelScript.astro`) that hands a visitor's
proposed change to a prefilled GitHub issue. All of it is progressive
enhancement — nothing here fetches data or renders content.

Requires Node.js >= 20.3 (CI runs 22).

## Commands

```sh
npm run dev      # dev server at http://localhost:4321
npm run build    # static output into dist/ — also validates every meetup YAML file
npm run check    # astro check: type-check components and content
npm test         # Playwright — webServer builds the site and serves dist/
npm run test:ui  # Playwright UI mode
npm run test:unit       # vitest, once (unit + integration; no browser, no build)
npm run test:unit:watch # vitest in watch mode
npm run test:all        # vitest then Playwright — what CI covers between two jobs
npm run lighthouse  # Lighthouse budgets against the built site (needs Chrome)
```

**Two test runners, split by filename**, because they can't share files:
`tests/**/*.spec.ts` is Playwright (`testMatch` in `playwright.config.ts`) and
`tests/{unit,integration}/**/*.test.ts` is vitest (`include` in
`vitest.config.ts`). Both filters exist so vitest can't pick up a `.spec.ts`
that imports `test` from `@playwright/test` and fail on it. A new test file
must land on the right side of that line — `.spec.ts` only for browser tests.

The Playwright tests run against the **built** site, not the dev server:
`webServer` runs `npm run build && node scripts/serve-dist.mjs`. Both `astro
dev` and `astro preview` daemonise and return immediately, which Playwright
reports as "webServer exited early" — so neither can be used there. The vitest
side touches neither a browser nor a build, so it's the fast feedback loop.

Single test / single file:

```sh
npx playwright test tests/homepage.spec.ts
npx playwright test -g 'filtering meetups by category works'
npx vitest run tests/unit/apply-suggestion.test.ts
npx vitest run -t 'skips blank lines'
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

**The "suggest an edit" pipeline is the second write path into that content,
and it is a five-part contract.** A visitor toggles edit mode
(`EditModeToggle.astro`), opens a card's panel (`EditPanelScript.astro`, one
delegated script for all cards), and is sent to a prefilled GitHub issue form
(`.github/ISSUE_TEMPLATE/suggest-edit.yml`); only fields they actually changed
are carried into the query string, so untouched fields read as "no change".
`.github/workflows/process-suggestion.yml` then pipes the raw issue body into
`scripts/apply-suggestion.mjs`, which parses GitHub's `### <label>` headings
back into fields, finds the meetup file by group name, edits *only* the
changed keys in place, and opens a PR.

The fragile seam is that the same field ids and labels are restated in the
form, the edit panel's `fieldToParam` map, and the script's lookups, while the
workflow's trigger matches the template's title prefix — a rename in any one
breaks the flow silently, at runtime, for a real contributor.
`tests/unit/suggest-edit-contract.test.ts` is what pins it: it reads the
template, `EditPanelScript.astro`, `apply-suggestion.mjs`,
`process-suggestion.yml` and `categories.ts`, and asserts the ids, labels,
title prefix and category options still line up. If you rename a field, expect
that test to fail and change all of them together rather than loosening the
test.

Two more properties of `apply-suggestion.mjs` are load-bearing and easy to
break: it splices values into the YAML text rather than re-serialising the
document, so an edit to one field leaves every other byte identical (no
reflowed summaries in the PR diff), and its I/O contract is stdin for the
issue body plus `$GITHUB_OUTPUT` for the step outputs, with `MEETUPS_DIR`
overriding the target directory. `tests/integration/process-suggestion.test.ts`
runs the real script as a subprocess against a temp copy of the meetups to hold
both of those in place.

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

- `.github/workflows/ci.yml` on PRs runs four jobs: `build` (`npm ci` + `npm
  run build`, then asserts `dist/CNAME` exists and reads `nottingham.digital`),
  `unit` (vitest), `test` (Playwright) and `lighthouse`.
- `.github/workflows/deploy.yml` on push to `main`: builds and publishes `dist/`
  to GitHub Pages. Repo Settings → Pages → Source must be **GitHub Actions**.
- `.github/workflows/deploy.yml` has a third job, `release`, which runs after the Pages deploy
  succeeds and only when `github.event_name == 'push'`. It creates tag
  `v<package.json version>` and a GitHub Release with generated notes — but
  only if that version has no release yet, so it is a no-op on every push that
  didn't bump. **Bumping the version in `package.json` is the act that cuts a
  release**; merging without a bump deploys and releases nothing. The daily
  cron rebuild and `workflow_dispatch` runs skip the job entirely, because
  they republish identical content. `.github/release.yml` groups the generated
  notes by label (`event-suggestion` → Listings, `dependencies` →
  Dependencies, everything else → Changes), which is why
  `process-suggestion.yml` labels the PR it opens and not just the issue.
  `ci.yml`'s `build` job prints a non-blocking `::notice::` when a PR changes
  files outside `src/content/meetups/**` without bumping the version — that
  is the only thing reminding a human to bump, so keep it advisory rather than
  making it a required check.
  Its `deploy` job needs `[build, unit, test]` — it re-runs the same vitest and
  Playwright jobs rather than trusting the PR run, so a direct push, an admin
  merge, or the cron can't republish a broken build. Those jobs are duplicated
  between the two workflow files; a change to one usually needs the same change
  in the other.
- `public/CNAME` is the one that ships (public/ is copied into dist/). The root
  `CNAME` is a leftover from when Pages served the branch root directly.
- `astro.config.mjs` pins `build.format: 'directory'` — do not switch to `file`
  format, it breaks the apex-domain URLs.
- The Playwright jobs install chromium only (the suite declares a single
  project) and upload `playwright-report/` as an artifact when they fail. Both
  cache `~/.cache/ms-playwright` keyed on the `package-lock.json` hash, since
  the browser build is pinned to the `@playwright/test` release.
- The `unit` job runs `npm run test:unit` with no browser install and no build,
  so it is the one that fails fast on a broken `apply-suggestion.mjs` or a
  drifted issue-form contract.
- The `lighthouse` job runs Lighthouse via
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
  3 pre-existing errors — an implicit `any` on the `event` parameter in
  `src/pages/index.astro`, and two implicit-`any` index expressions in
  `tests/unit/apply-suggestion.test.ts` (`parseIssueBody` returns an untyped
  map). The deprecated `z.string().url()` in the content schema is now a
  warning rather than an error. Fixing those three is what would let `check`
  become a CI gate.

## Contribution rules that affect edits

From `contributor-guide.md`: meetup titles link to the group's site or Meetup
page; summaries are short and scannable; groups must be in Nottingham or the
immediate area. `links` is an open array of `label`/`url` pairs (rather than fixed
`twitter`/`mastodon` fields) so a group can add any platform without a schema
change.

Longer-form implementation notes live in `.claude/plans/` — read the relevant one
before large changes to the build or the content set.
