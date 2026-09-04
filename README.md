# [Nottingham Digital](https://nottingham.digital/)

A place to find digital events and organisations in Nottingham.

The site is a static site built with [Astro](https://astro.build/) and deployed
to GitHub Pages. There is no server and no client-side framework — the meetup
list is rendered to plain HTML at build time.

## Adding or updating a meetup

Every meetup is a single YAML file in [`src/content/meetups/`](src/content/meetups).
To add one, create a new file there — you do not need to run the site locally,
and you do not need to touch any HTML:

```yaml
# src/content/meetups/my-meetup.yml
name: My Meetup
url: https://example.com/my-meetup
category: tech # tech | design | ops
cadence: Second Thursday
summary: >-
  A sentence or two about the group, written by the organisers.
links:
  - label: Mastodon
    url: https://example.social/@mymeetup
```

`links` is optional. `category` and `url` are validated on every pull request,
so a typo fails CI rather than reaching the live site.

See the [contributing guide](contributor-guide.md) for the house rules on
descriptions and titles.

## Development

Requires Node.js 20.3 or newer.

```sh
npm install
npm run dev      # local dev server at http://localhost:4321
npm run build    # static output into dist/
npm run preview  # serve the built site
npm run check    # type-check components and content
```

### Project layout

| Path | What it is |
| --- | --- |
| `src/content/meetups/*.yml` | The directory data — one file per meetup |
| `src/content.config.ts` | Schema the meetup files are validated against |
| `src/data/categories.ts` | The category list (`tech`, `design`, `ops`) |
| `src/styles/tokens.css` | **All** colours, fonts and spacing |
| `src/components/Logo.astro` | The site wordmark |
| `src/assets/nd-monogram.svg` | The "nd" mark, traced from the logo artwork |
| `src/data/analytics.ts` | The GoatCounter endpoint — the only analytics config |
| `src/lib/ics.mjs` | The RFC 5545 (iCalendar) writer, and reader, behind calendar export |
| `src/lib/calendar-links.mjs` | Google/Outlook "add to calendar" links and each event's `.ics` path |
| `src/lib/structured-data.mjs` | The schema.org JSON-LD graph rendered on the homepage |
| `scripts/check-live-site.mjs` | Daily health check run against the published site |
| `.github/workflows/deploy.yml` | Build and publish to GitHub Pages |
| `.github/workflows/monitor.yml` | Daily check that the live site is up and fresh |

### Retheming

Colour, type and spacing live entirely in `src/styles/tokens.css`, including the
dark-mode palette. Changing the site's look means editing that one file and
replacing `src/components/Logo.astro` — no component or page markup needs to
change. The monogram is filled from `--logo-ink` / `--logo-accent`, which
`.site-mark` maps onto the brand tokens, so the mark follows the theme rather
than carrying its own palette.

To add a category: add an entry to `src/data/categories.ts`, a matching
`--color-category-<id>` token in `src/styles/tokens.css`, and an icon in
`public/img/`.

## Deployment

Pushes to `main` trigger `.github/workflows/deploy.yml`, which builds the site
and publishes it to GitHub Pages. This requires the repository's
**Settings → Pages → Source** to be set to **GitHub Actions**.

## Analytics and monitoring

Visitor stats come from [GoatCounter](https://nottinghamdigital.goatcounter.com),
which is cookieless and stores nothing on the device — no consent banner, and
the dashboard is public. The endpoint lives in `src/data/analytics.ts` and
nowhere else; emptying that string removes the beacon, which is what a fork
should do.

`.github/workflows/monitor.yml` runs `scripts/check-live-site.mjs` every morning
against <https://nottingham.digital> and fails the run — which emails the
workflow's last committer — when the site is unreachable, when the build stamp
in `<meta name="build-time">` is more than 48 hours old (the daily deploy has
stopped), when fewer meetup cards are published than there are files in
`src/content/meetups/`, or when almost no group resolves an upcoming event
(the feeds in `scripts/fetch-next-events.mjs` have changed). Run it by hand
with:

```sh
node scripts/check-live-site.mjs            # against the live site
node scripts/check-live-site.mjs http://localhost:4321/   # against a local build
```

Pull requests also run Lighthouse against the built site (`lighthouserc.json`)
and attach the report as an artifact. The job is non-blocking until its
thresholds have been calibrated against a real run — see `CLAUDE.md`.
`npm run lighthouse` runs the same audit locally.

## Creator

Nottingham Digital is maintained by members of the Nottingham digital community.
See the contributors page in GitHub for more details.

Original design by [whatjoesays](https://twitter.com/whatjoesays) at
[JH](https://wearejh.com/).

## Plans

Longer-form implementation notes live in [`.claude/plans/`](.claude/plans):

| Plan | What it covers |
| --- | --- |
| [`2026-08-astro-rebuild.md`](.claude/plans/2026-08-astro-rebuild.md) | The move from hand-edited HTML to this Astro build |
| [`2026-08-content-refresh.md`](.claude/plans/2026-08-content-refresh.md) | Acting on the July 2026 audit of which meetups are still running |
| [`2026-08-monitoring.md`](.claude/plans/2026-08-monitoring.md) | Adding visitor analytics, live-site monitoring and Lighthouse budgets |
| [`2026-09-calendar-export.md`](.claude/plans/2026-09-calendar-export.md) | h-event and schema.org markup for event dates, and per-card calendar export |
