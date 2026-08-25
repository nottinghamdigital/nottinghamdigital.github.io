# Content refresh: acting on the July 2026 audit

## Context

The directory listed 19 meetups, unchanged in substance since roughly 2022. A
manual audit in July 2026 checked each one and found that **about half are no
longer running** — several have been dormant for years, and one has lost its
domain entirely.

This matters more than a normal staleness problem. The site's entire value
proposition is "where do I go this month". A visitor who picks a meetup at
random from the current list has roughly even odds of landing on a dead group.
The directory is not just out of date; it is actively misleading.

This plan turns the audit findings into content and schema changes. It assumes
the Astro rebuild (PR #133) has landed, since it works in terms of the
one-file-per-meetup layout that PR introduced.

**Source:** manual audit, verified July 2026. Network access was blocked in the
session that wrote this plan, so none of the findings were independently
re-checked here — they are taken as given from the audit.

---

## Do this first, separately from everything else

**`tech-nottingham.yml` points at a domain that is no longer Tech Nottingham.**

The audit reports `technottingham.com` now serves a casino comparison site. The
directory currently sends visitors there from a card carrying a trusted
community name, and the site is served from the community's own domain — so the
endorsement is implicit and the reputational exposure is real.

Treat this as a hotfix, not part of the batch below: delete
`src/content/meetups/tech-nottingham.yml`, ship it, then do the rest at
whatever pace suits. It needs no schema work and no discussion.

Worth a five-second look at the URL to confirm before shipping, purely because
acting on a domain-takeover report is easier to justify with a first-hand look.
The removal is correct either way — the group is not running.

---

## The verdicts

Nine confirmed active, nine confirmed ended, one new, two unresolved.

### Active — keep, with corrections (8)

| File | Change needed |
| --- | --- |
| `nottingham-data-science-and-ai.yml` | Confirmed. Add venue: Newton Building, NTU |
| `nottingham-programmers.yml` | Confirmed. Cadence is informal/roughly monthly, not "Last Thursday". Venue varies (pub) |
| `devops-notts.yml` | Confirmed. Add venue: Fothergill House, 16 King St, NG1 2AS. Now **hybrid** |
| `agile-nottingham.yml` | **Cadence changed**: monthly → roughly quarterly. Venue: Kerv, 34 Carrington Street |
| `notts-iot.yml` | Confirmed. Now **hybrid** (Zoom + in person) — currently implied in-person |
| `notts-techfast.yml` | Confirmed. Now **hybrid**. Venue: Fothergill House, King St. Breakfast format |
| `dot-net-notts.yml` | **Rename** to ".NET Notts" — currently lowercase "dot net notts". Mixed in-person/hybrid/virtual |
| `pass-east-midlands.yml` | **Renamed group**: PASS East Midlands → **East Midlands Data**. 2nd Wednesday, alternates Nottingham/Derby |

Two renames worth care: `.NET Notts` is a display-name fix, but **East Midlands
Data is a genuine rebrand** — rename the file to `east-midlands-data.yml` so
the filename doesn't preserve a name the group has dropped.

### New — add (1)

**Built in Notts** — weekly, Wednesdays, Antenna Nottingham, Beck Street.
<https://www.builtinnotts.com/events> — category `tech`.

The only weekly entry in the directory, and the most frequent thing on the list.

### Ended — remove (9)

| File | Last activity |
| --- | --- |
| `cyber-security-nottingham.yml` | No event since 2019 |
| `notts-dev-workshop.yml` | No events since 2019 |
| `ladies-that-ux-nottingham.yml` | Last event 2018; Facebook group near-silent |
| `homebrew-website-club.yml` | No event since 2021 |
| `phpminds.yml` | No event since 2022 |
| `ministry-of-testing-nottingham.yml` | No event in 2+ years (last: June 2024) |
| `web-notts.yml` | No events found |
| `drink-digital.yml` | **Moved to Derby** — out of scope per the contributor guide's "Nottingham or the immediate area" rule |
| `tech-nottingham.yml` | Not running; domain repurposed (see hotfix above) |

Note `drink-digital` is a different case from the rest: it did not die, it
relocated. If it is removed for being out of area, that reasoning belongs in the
commit message so nobody re-adds it later thinking it was an oversight.

### Unresolved — do not guess (2)

- **`women-in-tech-nottingham.yml`** — last event 2025, and its website is gone
  because `technottingham.com` was re-used. Recent enough that removing it may
  be wrong; the Meetup page is the only remaining signal. Needs one check
  before a decision.
- **`nottingham-r-user-group.yml`** — **absent from the audit entirely.** It was
  not marked active or dead, it simply wasn't covered. It is listed as
  "Quarterly", which makes dormancy hard to distinguish from a normal gap.
  Needs checking before this refresh can claim to be complete.

Also checked and **not** to be added: **Craft CMS Notts** — quarterly, last event
March 2025, no event in over a year. Recording it here so the next audit doesn't
spend time rediscovering it.

### Net effect

19 listed → **9 active**, 2 pending a check, 9 removed. Roughly half the
directory disappears, which is the point: what remains is true.

---

## Schema changes

The audit collected three kinds of information the current schema cannot hold.
Each is justified by the findings rather than added speculatively.

### 1. `status` — so dead groups can leave the list without leaving the record

```yaml
status: active # active | dormant | ended
```

This maps directly onto the audit's own ✅ / ❓ / ❌ split.

- `active` — renders in the main list
- `dormant` — renders in a separate, visually quieter "Quiet at the moment"
  section; covers the two unresolved entries honestly instead of forcing a
  premature keep-or-delete call
- `ended` — does not render at all, but the file stays in the repo

Keeping `ended` files rather than deleting them means the reason a group left
the list is recorded where the next maintainer will look, and a well-meaning
contributor re-adding PHPMinds in 2028 hits an existing file explaining why it
went. Default `active`, so existing files and new contributions are unaffected.

**This is the main decision to agree before implementing.** The alternative —
just deleting the nine files and trusting git history — is simpler and
defensible. It is only worse in that the reasoning becomes invisible to anyone
not running `git log` on a deleted path.

### 2. `venue` and `format` — the audit collected both

```yaml
venue: Fothergill House, 16 King St, NG1 2AS # optional
format: hybrid # in-person | hybrid | online
```

`format` earns its place on the findings alone: Notts IoT, Techfast, DevOps
Notts and .NET Notts have all moved to hybrid or mixed delivery, which is a
post-2020 change the current data cannot express. It is also the single most
useful filter for someone deciding whether they need to travel.

`venue` is optional — several groups genuinely vary.

### 3. `lastVerified` — so this never rots invisibly again

```yaml
lastVerified: 2026-07
```

This is the change that addresses the *cause* rather than the symptoms. The
directory reached ~50% dead entries because nothing recorded when each entry was
last known good, so staleness was invisible until someone audited all 19 by
hand.

With a per-entry date, the site can surface "checked July 2026" in the footer,
and a CI job can flag entries not verified in 12 months. The next audit then
starts from a list of what needs checking rather than from scratch.

### Explicitly not adding: next-event dates

The audit lists next-event dates, several marked "estimated from pattern". These
should **not** go in the content files. A hardcoded date is wrong within weeks
and produces exactly the failure the old site had — the jQuery/moment API fetch
that PR #133 removed existed to solve this and had itself gone stale.

`cadence` ("Last Tuesday of the month") stays the right level of detail: it is
true for as long as the group runs, and a reader can act on it. Live dates, if
ever wanted, belong in a build-time fetch from Meetup's API, not in hand-edited
files.

---

## Suggested sequence

1. **Hotfix** — remove `tech-nottingham.yml`. Ship alone.
2. **Schema** — add `status`, `venue`, `format`, `lastVerified` to
   `src/content.config.ts`, all optional or defaulted so nothing breaks. Update
   `MeetupCard.astro` to show venue and a format badge, and `index.astro` to
   split active from dormant.
3. **Corrections** — the 8 active entries, including both renames.
4. **Additions** — Built in Notts.
5. **Removals** — the remaining 8 ended entries, in one commit with the audit
   date and each group's last-activity year in the message.
6. **Resolve the two unknowns** — Women in Tech and Nottingham R User Group.
   Do not fold this into step 5; it needs a decision, not a batch edit.
7. **Docs** — update `contributor-guide.md` with the new fields, and note the
   expectation that entries carry a `lastVerified` date.

Steps 1 and 3–5 are content-only and need no review beyond the facts. Step 2 is
the one that needs agreement first.

---

## Verification

- `npm run build` validates every file against the schema; a bad `status` or
  `format` value fails the build.
- Card count should drop from 19 to 9 active (+2 dormant if that route is
  taken). Assert the new number in the Playwright suite so an accidental
  deletion is caught.
- Check no removed group is still reachable — no orphaned links from the
  category filters or the print stylesheet.
- Confirm the category filters still make sense. Counting the changes above,
  the active list ends up:

  | Category | Now | After refresh |
  | --- | ---: | ---: |
  | tech | 13 | 6 |
  | ops | 4 | 3 |
  | **design** | 2 | **0** |

  **The `design` category empties completely** — its only two entries, Ladies
  That UX and Web Notts, are both removals. A Design filter button that returns
  zero results is a dead control, so either render filters only for categories
  with at least one active meetup, or drop `design` from
  `src/data/categories.ts` until something fills it.

  Rendering filters conditionally is the better fix: it is a few lines, it
  survives the category coming back, and it stops the same problem recurring.
  Worth deciding before deploy rather than discovering after.

  That the directory has no active design meetup at all is also a finding in
  its own right, and probably of interest to the community beyond this repo.
