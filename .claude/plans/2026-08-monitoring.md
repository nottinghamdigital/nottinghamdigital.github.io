# Monitoring and statistics for nottingham.digital

## Context

The site currently ships with no visibility of any kind: nobody knows how many
people use the directory, and nothing watches the published site. That second
gap is the sharper one. `deploy.yml` runs a **daily scheduled build** whose
`prebuild` step (`scripts/fetch-next-events.mjs`) fetches meetup.com / Luma /
Built In Notts feeds, and by deliberate design those fetches fail *silently* —
a group with an unreachable feed just loses its "Next:" line. So the whole
next-events feature can quietly degrade to nothing and the site will keep
deploying green. GitHub also auto-disables scheduled workflows after 60 days
without repo activity, which would freeze the data with no visible failure.

GitHub Pages gives no server logs and no way to run anything server-side, so
everything here is either a client-side beacon or an external prober. The plan
adds three things, all free, all keeping the site's "no framework, no cookies"
character:

1. **Visitor analytics** — GoatCounter, cookieless, ~3.5KB, public dashboard.
2. **Published-site monitoring** — a daily workflow that checks the *live* site
   for freshness, completeness and availability.
3. **Lighthouse budgets in CI** — so a performance or accessibility regression
   fails the PR rather than the visitor.

Out of scope by decision: link-rot checking, and an external minute-resolution
uptime prober (item 2 gives daily-resolution availability as a side effect).

## 1. Visitor analytics — GoatCounter

**`src/data/analytics.ts`** (new) — one constant, mirroring how
`src/data/categories.ts` is the single source for categories:

```ts
/** GoatCounter endpoint. Empty string disables analytics — forks should clear it. */
export const GOATCOUNTER_ENDPOINT = 'https://nottinghamdigital.goatcounter.com/count';
```

**`src/layouts/BaseLayout.astro`** — render the beacon just before `</body>`,
never in `<head>`, so it cannot touch LCP:

```astro
{GOATCOUNTER_ENDPOINT && (
  <script is:inline data-goatcounter={GOATCOUNTER_ENDPOINT}
          async src="//gc.zgo.at/count.js"></script>
)}
```

This is the maintainer's existing GoatCounter snippet verbatim, with only the
endpoint lifted out into the constant.

`is:inline` keeps it out of Astro's bundler, matching the existing inline
scripts. `count.js` refuses to send from `localhost` and `file://`, so
`npm run dev` and the Playwright suite (which serves `dist/` on
`localhost:4321`) never pollute the stats — no extra guard needed.

Also add, in `<head>`, a build stamp the monitor in §2 reads:

```astro
<meta name="build-time" content={new Date().toISOString()} />
```

**`src/pages/index.astro`** — one more `<p>` in the existing footer (no CSS
needed; `.footer p + p` already handles spacing):

> Visitor stats are [public](https://nottinghamdigital.goatcounter.com/) — no
> cookies, no personal data.

GoatCounter stores no cookies and nothing on the device (it hashes IP + UA
server-side with a daily-rotated salt), so no consent banner is required and
the site's privacy posture is unchanged.

**`tests/homepage.spec.ts`** — a new `describe('analytics')` with two tests:
the beacon tag is present with the expected `data-goatcounter` endpoint and is
`async`; and `context.cookies()` is empty after load. The second is the test
that actually defends the promise in the footer.

### Maintainer setup (cannot be automated from here)

The `nottinghamdigital.goatcounter.com` site already exists, so the only
remaining step is optional: in GoatCounter → Settings, tick **make dashboard
public** if the footer should link to it. If you would rather keep the
dashboard private, drop the link and the footer line becomes just "No cookies,
no personal data." No secrets and no repo settings either way — the endpoint is
public by design.

## 2. Published-site monitoring

**`scripts/fetch-next-events.mjs`** — keep it exit-0 always (a flaky feed must
never block a deploy), but extend `main()` to append its resolved/total count
and the list of unresolved slugs to `$GITHUB_STEP_SUMMARY` when that env var
exists. No-op locally; makes every deploy run self-describing.

**`scripts/check-live-site.mjs`** (new) — fetches `https://nottingham.digital`
and exits non-zero with a specific message on any of:

| Check | Catches |
| --- | --- |
| HTTP 200 + `text/html` | site down, DNS/TLS broken, Pages misconfigured |
| `<meta name="build-time">` newer than 48h | deploy cron failed, or auto-disabled after 60 days of inactivity |
| `data-category` card count ≥ number of `src/content/meetups/*.yml` files | a broken build publishing an empty or partial directory |
| `data-next-event-date` count ≥ `MIN_NEXT_EVENTS` (default 3) | the silent RSS/feed breakage described above |

It writes the same table to `$GITHUB_STEP_SUMMARY`. Card and next-event
attributes already exist in `MeetupCard.astro` (lines 36, 62–67), so nothing in
the markup changes for this.

**`.github/workflows/monitor.yml`** (new) — `schedule: '30 7 * * *'` (90
minutes after the 06:00 deploy cron) plus `workflow_dispatch`;
`permissions: contents: read`; checkout + setup-node 22 + `node
scripts/check-live-site.mjs`. A failing run turns the run red, which is the
notification channel: GitHub emails the workflow file's last committer on
scheduled-workflow failure, with no external account or secret involved.

Honest limitation to note in the docs: this workflow's own cron is subject to
the same 60-day auto-disable, though GitHub emails a warning before doing it.

## 3. Lighthouse budgets in CI

**`lighthouserc.json`** (new, repo root): `startServerCommand: node
scripts/serve-dist.mjs`, url `http://localhost:4321/`, `numberOfRuns: 3`
(LHCI takes the median), desktop preset, and `upload.target: filesystem` so the
reports land in `.lighthouseci/reports/` and CI can attach them as an artifact
— the same pattern the repo already uses for `playwright-report/`, and nothing
is published to a third party.

Lighthouse CI itself is **not** added to `devDependencies`. `@lhci/cli` pulls a
puppeteer/inquirer tree — roughly 600 packages carrying ten audit advisories
(seven high) — into a repo with five dependencies, none of which ship to
visitors but all of which sit in the lockfile. `treosh/lighthouse-ci-action`
supplies it in CI instead, reading the same `lighthouserc.json`, and
`npm run lighthouse` (`npx --yes @lhci/cli@0.15.x autorun`) runs the identical
audit locally without touching the lockfile.

Assertion split, chosen for signal rather than noise:

- `categories:accessibility` — **error**, minScore `1`. Deterministic, and
  a11y is load-bearing in this repo (see the `--color-on-accent` note).
- `categories:seo`, `categories:best-practices` — **error**, minScore `1` /
  `0.95`.
- `categories:performance` — **warn** initially. It depends on the Google
  Fonts stylesheet and the new beacon, both third-party, so the threshold
  should be set from the first three observed medians rather than guessed;
  flip to **error** once a real number is in hand.

**`.github/workflows/ci.yml`** — a third job `lighthouse` alongside `build` and
`test`: checkout, setup-node 22 + npm cache, `npm ci`, `npm run build`, then
`treosh/lighthouse-ci-action@v12` with `configPath: ./lighthouserc.json`, and
an `if: failure()` upload of `.lighthouseci/reports/`. Adds roughly a minute to
PR CI.

## Files touched

| File | Change |
| --- | --- |
| `src/data/analytics.ts` | new — the one analytics constant |
| `src/layouts/BaseLayout.astro` | beacon before `</body>`, `build-time` meta in `<head>` |
| `src/pages/index.astro` | footer privacy/stats line |
| `tests/homepage.spec.ts` | beacon present + no cookies |
| `scripts/fetch-next-events.mjs` | step-summary output (still always exit 0) |
| `scripts/check-live-site.mjs` | new — live-site assertions |
| `.github/workflows/monitor.yml` | new — daily live check |
| `.github/workflows/ci.yml` | new `lighthouse` job |
| `lighthouserc.json`, `package.json`, `.gitignore` | LHCI config, `lighthouse` script, ignore `.lighthouseci/` |
| `README.md`, `CLAUDE.md` | document analytics, monitoring, the new workflow |
| `.claude/plans/2026-08-monitoring.md` | this plan, per repo convention; linked from the README Plans table |

## Verification

1. `npm run build` — succeeds; `dist/index.html` contains the `gc.zgo.at`
   beacon and a `build-time` meta.
2. `npx playwright test` — full suite green, including the two new analytics
   tests (they also prove the beacon does not break the no-JS path).
3. `npm run lighthouse` locally — record the three performance medians and set
   the threshold from them.
4. `node scripts/check-live-site.mjs` against the *current* live site — should
   pass every check except `build-time`, which cannot exist until this ships.
   After merge, wait for `deploy.yml`, then run `monitor.yml` via
   `workflow_dispatch` and confirm all four checks pass.
5. Open the PR and confirm `build`, `test` and `lighthouse` jobs are green.
6. After deploy, load nottingham.digital and confirm the pageview lands on the
   GoatCounter dashboard and that no cookies are set (DevTools → Application →
   Cookies, empty).
