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
| `.github/workflows/deploy.yml` | Build and publish to GitHub Pages |

### Retheming

Colour, type and spacing live entirely in `src/styles/tokens.css`, including the
dark-mode palette. Changing the site's look means editing that one file and
replacing `src/components/Logo.astro` — no component or page markup needs to
change.

To add a category: add an entry to `src/data/categories.ts`, a matching
`--color-category-<id>` token in `src/styles/tokens.css`, and an icon in
`public/img/`.

## Deployment

Pushes to `main` trigger `.github/workflows/deploy.yml`, which builds the site
and publishes it to GitHub Pages. This requires the repository's
**Settings → Pages → Source** to be set to **GitHub Actions**.

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
