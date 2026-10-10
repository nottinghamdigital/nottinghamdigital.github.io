# Calendar export: h-event, schema.org, and "Add to calendar" per card

## Context

Each card already knows when a group's next event is: `scripts/fetch-next-events.mjs`
resolves meetup.com / Luma / Eventbrite sources at build time into
`src/data/next-events.generated.json`, and `MeetupCard.astro` renders the result
as a "Next:" line. That date is currently **human-readable only** — a
`<span>` holding `Tue, 8 Sep`, plus a `data-next-event-date` attribute that
exists for the monitor and the client-side "this week" badge, not for machines
in general.

Three things follow from that:

1. A visitor who wants the event in their calendar has to click through to
   meetup.com/Luma/Eventbrite and use *their* add-to-calendar button. For a
   directory whose whole job is "what's on in Nottingham", that is the one
   action we make hardest.
2. Search engines see no events. The site is a list of groups with dates in
   prose; nothing is eligible for an Event rich result.
3. The cards carry h-card microformats for the *group* but nothing for the
   *event*, so a microformat consumer sees an organisation with no calendar.

This plan adds, in one feature: **h-event microformats** on the next-event
markup, a **schema.org `Event` graph** as JSON-LD, and a **per-card "Add to
calendar" control** backed by real `.ics` files generated at build time —
with unit tests and a documented compatibility matrix across web and desktop
calendar clients.

Design constraints inherited from the rest of the repo, all of which this
plan keeps:

- **Contributing a meetup is still one file.** No new required YAML fields.
- **No client-side data fetching or rendering.** Everything is emitted at
  build time; the add-to-calendar menu is a `<details>` element and three
  ordinary links, so it works with JavaScript off.
- **No new runtime dependencies.** ICS is ~150 lines of string building; a
  library is not worth the tree.
- **The monitor's greps keep working.** `data-category` and
  `data-next-event-date` stay exactly where they are.

## The blocker: the generated event data is too thin

`next-events.generated.json` entries are `{ title, url, date }`. A calendar
entry needs an end time and, ideally, a location — a one-hour placeholder in
someone's calendar is worse than useful, and schema.org's `Event` wants
`location`. So **phase 1 is widening the fetcher**, and everything else
consumes the wider shape.

Target shape (all new fields optional, so a stale generated file from a
previous build still renders):

```jsonc
{
  "dot-net-notts": [
    {
      "title": "Monthly meetup",
      "url": "https://www.meetup.com/dotnetnotts/events/123456/",
      "date": "2026-09-28T18:00:00.000Z",   // unchanged: ISO UTC start
      "end": "2026-09-28T20:30:00.000Z",    // new, optional
      "location": {                          // new, optional
        "name": "Nottingham Tech Hub",
        "address": "1 Example Street, Nottingham NG1 1AA",
        "online": false
      }
    }
  ]
}
```

Per source:

- **meetup.com** — `fetchEventStartDate()` already parses the event page's
  schema.org `Event` JSON-LD purely to read `startDate`. Rename it to
  `fetchEventDetails()` and return `endDate` and `location` from the same
  block (`location` is a `Place` with `name`/`address`, or a
  `VirtualLocation` with `url` for online events). This is free — the data is
  already in the object we parse and throw away.
- **Luma** — the ICS loop in `fetchLumaNextEvent()` already walks every line;
  capture `DTEND` and `LOCATION` alongside `DTSTART`/`SUMMARY`. Also free.
- **Eventbrite** — `basicInfo.endDate.utc` is usable for a one-off, but per
  the existing comment in the script it is *the end of the series* when
  `context.basicInfo.isSeries` is true, so it must be ignored there. Venue
  data lives under `context` (verify the exact path against a live fetch
  before relying on it — Eventbrite's `__NEXT_DATA__` shape is undocumented
  and this script already treats it as such).
- **Fallback** — no end time resolved ⇒ `DEFAULT_EVENT_DURATION_MINUTES = 120`,
  applied by the ICS/link builders rather than baked into the JSON, so the
  generated file stays a record of what the feed actually said.

Failures stay non-fatal, as everywhere else in this script: a source that
yields no end time or location still yields an event.

## Where the code goes

Three new modules under a new `src/lib/`, written as **`.mjs` with JSDoc
types** rather than `.ts`, for one specific reason: `scripts/fetch-next-events.mjs`
runs under bare `node` and cannot import TypeScript, and the ICS *reader* it
already contains (`unfoldIcsLines`, `unescapeIcsValue`) belongs next to the
ICS *writer*. One module, used by the Luma reader, the endpoint, and the
tests — and the writer's output round-trips through the reader in the test
suite, which is a much stronger check than asserting on strings.

`astro/tsconfigs/strict` sets `allowJs`, so `.astro` files and vitest import
these directly and `npm run check` still type-checks them from the JSDoc.

| File | Contents |
| --- | --- |
| `src/lib/ics.mjs` | `buildIcs(events, opts)`, `buildEventIcs(event, opts)`, the private `line()` builder every property goes through, `formatIcsUtc`, plus the existing `unfoldIcsLines`/`unescapeIcsValue` moved here |
| `src/lib/calendar-links.mjs` | `googleCalendarUrl(event)`, `outlookCalendarUrl(event)`, `icsPathFor(slug, event)` |
| `src/lib/structured-data.mjs` | `eventGraph(meetups, nextEvents, site)` → the JSON-LD object |
| `src/lib/next-events.mjs` | `loadNextEvents()` — the read-and-catch currently inlined in `index.astro`, so the page and the `.ics` endpoint share one loader |

`src/data/` stays what it is (constants: categories, analytics, link icons);
logic goes in `src/lib/`.

## 1. ICS generation

### The endpoint

`src/pages/calendar/[event].ics.ts` — an Astro static endpoint with
`getStaticPaths()` over `getCollection('meetups')` × `loadNextEvents()`,
emitting one file per upcoming event:

```
/calendar/dot-net-notts-20260928T1800Z.ics
```

The start time is in the URL deliberately: the file is then content-addressed,
so a rescheduled event gets a new URL rather than a stale cached body, and a
`-2` suffix disambiguates the (rare, Eventbrite-sibling) case of two events
for one group at the same instant. Endpoints with an explicit extension are
emitted verbatim under `build.format: 'directory'` — confirm with
`ls dist/calendar/` after the first build.

Keep the endpoint a **thin shell**: it maps entries through
`buildEventIcs()` and returns a `Response`. All logic worth testing lives in
`src/lib/ics.mjs`, which imports nothing from `astro:content` and so needs no
vitest/Astro plumbing.

### Compliance details that actually matter

These are the things real clients reject, and each one has a test in §5:

- **CRLF line endings** throughout, including the final line. Apple Calendar
  and Outlook desktop are the strict ones here.
- **Folding at 75 octets**, continuation lines starting with a single space —
  and folded on *octet* boundaries without splitting a UTF-8 multi-byte
  sequence. Group names contain em dashes and the occasional emoji.
- **One chokepoint for every property line.** `SUMMARY`, `DESCRIPTION` and
  `LOCATION` are filled from scraped third-party feed text, so escaping is
  not a convention to remember at each call site: `buildEventIcs` never
  concatenates a line or accepts pre-built ones. Every line is produced by a
  single private `line(name, value, opts)` helper that escapes `\` `;`
  `,` and newlines, strips control characters, and folds — so a value
  physically cannot introduce a second line, and there is no code path that
  writes a raw one. The escaping rules live in that one function; adding a
  property later cannot get them wrong by omission.
- **`UID`** stable and globally unique: `<slug>-<compact start>@nottingham.digital`.
  Stability is what makes a re-import update the existing entry instead of
  duplicating it.
- **`DTSTAMP`** is injected (`buildEventIcs(event, { now })`) rather than read
  from the clock inside the builder, so tests are deterministic. The endpoint
  passes build time, which is honest — the files are regenerated by the daily
  deploy.
- **UTC times only** (`20260928T180000Z`). No `VTIMEZONE`, no floating times,
  no `TZID` — unambiguous everywhere, and the site already normalises every
  date to a UTC ISO string. Display stays `Europe/London` via
  `toLocaleDateString`, unchanged.
- **No `ORGANIZER`.** RFC 5545 wants a `CAL-ADDRESS` (a `mailto:`), we have
  none, and a fabricated one is worse than omission — some clients surface it
  as a reply-to address.
- Header: `VERSION:2.0`, `PRODID:-//Nottingham Digital//nottingham.digital//EN`,
  `CALSCALE:GREGORIAN`, `METHOD:PUBLISH`. Per event: `UID`, `DTSTAMP`,
  `DTSTART`, `DTEND`, `SUMMARY`, `DESCRIPTION` (group name, its summary, and
  the event URL), `URL`, `STATUS:CONFIRMED`, `TRANSP:OPAQUE`, and `LOCATION`
  only when known — an empty `LOCATION:` renders as a blank venue field in
  Outlook rather than no venue.
- Served as `text/calendar; charset=utf-8` — the header iOS Safari and
  Android Chrome use to decide between opening the file in a calendar and
  showing it as text. GitHub Pages maps `.ics` to that from its standard MIME
  table, so the published site needs nothing. `scripts/serve-dist.mjs` has
  its own small `TYPES` map and needs `'.ics'` added to it, so local runs and
  the Playwright suite behave like production; that lands in the same step as
  the endpoint (§Order of work, step 4), before anything depends on it.

### The one function that writes lines

The chokepoint above is the whole mitigation, so it is worth being concrete
about its shape — including the part that "just escape everything" gets
wrong:

```js
const CRLF = '\r\n';

/**
 * The only function in this module that produces an ICS line. Every
 * property — SUMMARY, DTSTART, UID, the VCALENDAR wrapper's own — is built
 * here, so escaping and folding cannot be forgotten at a call site and a
 * value cannot introduce a line of its own.
 *
 * `text: false` is for values that are not RFC 5545 TEXT: URI (`URL`),
 * DATE-TIME (`DTSTART`), and the structural `BEGIN`/`END`/`VERSION`.
 * Escaping those as TEXT is not merely unnecessary, it corrupts them — a
 * comma is legal in a URL and would be emitted as `\,`. They still go
 * through here, and still have every control character removed, so the
 * injection property holds for both value types.
 */
function line(name, value, { params = {}, text = true } = {}) {
	const encoded = text ? escapeText(value) : stripControls(value);
	const paramText = Object.entries(params)
		.map(([k, v]) => `;${k}=${stripControls(v)}`)
		.join('');
	return fold(`${name}${paramText}:${encoded}`);
}

/**
 * RFC 5545 TEXT escaping. Order matters twice over: backslashes before the
 * characters whose escapes introduce one, and the newline rule before
 * `stripControls`, so a real newline survives as the two characters `\n`
 * while every other control character is removed.
 */
function escapeText(value) {
	return stripControls(
		String(value)
			.replace(/\\/g, '\\\\')
			.replace(/;/g, '\\;')
			.replace(/,/g, '\\,')
			.replace(/\r\n|[\r\n]/g, '\\n'),
	);
}

/** Removes every C0 control character and DEL — CR and LF included. */
function stripControls(value) {
	return String(value).replace(/[\u0000-\u001f\u007f]/g, '');
}

/** Folds to 75 octets, never splitting a UTF-8 sequence. */
function fold(text) {
	const bytes = Buffer.from(text, 'utf8');
	if (bytes.length <= 75) return text;
	const parts = [];
	for (let start = 0; start < bytes.length; ) {
		// 75 octets on the first line; 74 after, since the fold's leading space counts.
		let end = Math.min(start + (start === 0 ? 75 : 74), bytes.length);
		// Back off any UTF-8 continuation byte (0b10xxxxxx) so a character is never split.
		while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
		parts.push((start === 0 ? '' : ' ') + bytes.subarray(start, end).toString('utf8'));
		start = end;
	}
	return parts.join(CRLF);
}
```

`stripControls` strips CR and LF along with everything else, which is what
makes the non-TEXT path safe: a URL or a parameter value has no escaping
mechanism to fall back on, so its newlines must simply cease to exist. TEXT
values reach it having already had theirs converted, so nothing is lost.

`buildEventIcs` is then only assembly, with nothing to get wrong:

```js
export function buildEventIcs(event, { now, defaultDurationMinutes = 120 }) {
	const lines = [
		line('BEGIN', 'VCALENDAR', { text: false }),
		line('VERSION', '2.0', { text: false }),
		// … PRODID, CALSCALE, METHOD, BEGIN:VEVENT, UID, DTSTAMP, DTSTART, DTEND
		line('SUMMARY', event.title),
		line('URL', event.url, { text: false }),
	];
	if (event.location?.name) lines.push(line('LOCATION', event.location.name));
	// … END:VEVENT, END:VCALENDAR
	return lines.join(CRLF) + CRLF;
}
```

There is no `push` of a template literal anywhere in the module — that is the
invariant a reviewer checks, and §5 pins it from the outside by asserting
every emitted line either opens a property (`/^[A-Z][A-Z-]*[;:]/`) or is a
fold continuation (`/^ /`). A raw line smuggled in by a later change fails
that whether or not anyone thought to test the value it carried.

### Optional: a whole-site feed

`src/pages/events.ics.ts` — every upcoming event in one calendar, with
`X-WR-CALNAME:Nottingham Digital`, `REFRESH-INTERVAL;VALUE=DURATION:PT24H`
and `X-PUBLISHED-TTL:PT24H`, linked from the footer as a subscription
(`webcal://nottingham.digital/events.ics`). The same `buildIcs()` call with
every event instead of one, so it is a handful of lines — and the daily
deploy cron is what keeps a subscription fresh. Droppable if the feature is
getting long; it is not what the request asked for, but it is the natural
companion to it.

## 2. The "Add to calendar" control

Inside each next-event `<li>`, after the existing link and "This week" badge:

```astro
<details class="add-to-calendar">
  <summary aria-label={`Add ${event.title} to your calendar`}>
    <span class="icon" style="--icon-src: url(/img/calendar-add.svg);" aria-hidden="true"></span>
    Add to calendar
  </summary>
  <ul>
    <li><a href={googleCalendarUrl(event)} rel="noopener">Google Calendar</a></li>
    <li><a href={outlookCalendarUrl(event)} rel="noopener">Outlook Web</a></li>
    <li><a href={icsPathFor(slug, event)} download>Download .ics</a></li>
  </ul>
</details>
```

Why this shape:

- **`<details>` needs no JavaScript.** The disclosure works with JS off, which
  the rest of the site's interactive bits (filters, theme toggle) can only
  emulate. No new inline script is added by this feature at all.
- **Three targets covers the field.** Google and Outlook Web are the two
  hosted calendars where a template URL beats a download; the `.ics` file
  covers Apple Calendar (macOS/iOS), Outlook desktop, Thunderbird, and Google
  Calendar's own import for anyone who prefers it. An Office 365
  (`outlook.office.com`) deeplink is one more line if work accounts turn out
  to matter; it is left out to keep the menu at three.
- **No nested interactive elements**: the control is a sibling of the event
  link, not inside it.

Link formats:

- Google: `https://calendar.google.com/calendar/render?action=TEMPLATE&text=…&dates=<start>/<end>&details=…&location=…`,
  dates in compact UTC (`YYYYMMDDTHHmmssZ`).
- Outlook Web: `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=…&startdt=<ISO>&enddt=<ISO>&body=…&location=…`,
  dates as full ISO 8601.

Both built with `URLSearchParams` so encoding is not hand-rolled.

New assets and styles:

- `public/img/calendar-add.svg`, in the same single-colour style as
  `event.svg` — the `.icon` rule masks `currentColor`, so the file only needs
  correct geometry.
- `global.css` gets the `.add-to-calendar` rules; any colour goes in
  `tokens.css`, per the standing rule that no other stylesheet holds a raw
  colour.
- `print.css` hides `.add-to-calendar` — a printed directory has no use for
  a disclosure menu.

## 3. h-event microformats

The card is an `h-card` for the group. The next-event list items become
nested `h-event`s — a valid mf2 structure, where a root class with no
property class parses as a child microformat of the h-card:

```astro
<li class="h-event" data-event-date={event.date}>
  <a class="u-url" href={event.url}>
    <time class="dt-start" datetime={event.date}>{formatDate(event.date)}</time>
    <span class="p-name"> — {event.title}</span>
  </a>
  {event.end && <time class="dt-end" datetime={event.end} hidden></time>}
  {event.location?.name && <span class="p-location" hidden>{event.location.name}</span>}
</li>
```

Notes:

- The date `<span>` becomes a `<time datetime>`. That is the whole point of
  the exercise — the visible text stays `Tue, 8 Sep` while the attribute
  carries the full instant — and it improves the markup for assistive tech
  regardless of microformats.
- `dt-end` and `p-location` are emitted only when known, using `hidden`
  elements where there is no visible counterpart. (`hidden` elements are
  still parsed by mf2 consumers; this is the documented way to expose a value
  that has no visual presence.)
- **mf2 `h-event`, not legacy hCalendar `vevent`.** Dual-classing means
  carrying the deprecated `<abbr class="dtstart" title="…">` pattern for the
  old parsers, which is worse markup for a vanishing audience. mf2 is the
  hCalendar successor and is what current parsers read.
- `NextUpHero.astro` gets the same treatment for consistency — with one
  catch: its `promote()` function mutates the primary card's DOM when an
  event passes, so it must also update the `datetime` attribute and the
  hidden values, not just the visible text. Miss that and the hero's
  microformats silently describe the event that just ended.

## 4. schema.org

**JSON-LD in `<head>`, one block for the page**, built by
`eventGraph()` and rendered by `index.astro` — not microdata attributes on
the cards. Three reasons: the hero mutates its own DOM (so attribute-based
markup goes stale, exactly as above), category filtering hides cards
(`hidden` cards are still in the DOM, so this one is survivable, but it is
another thing to reason about), and a single block is one place to maintain
and one thing to unit-test.

Shape: an `ItemList` of `Event`s, each with `name`, `startDate`, `endDate`,
`url`, `eventStatus: EventScheduled`, `eventAttendanceMode` (Offline unless
the source said online), and an `organizer` pointing at an `Organization`
node for the group (`@id` = the group's URL, `name`, `url`, `description` =
its summary). The group `Organization` nodes are emitted once in the same
`@graph` and referenced by `@id`, so a group with two upcoming events is not
described twice.

**`location`:** emitted when the feed gave us one, omitted when it did not.
Google's Event rich result *requires* `location`, so events without one will
not be eligible — and the alternative, defaulting every unknown venue to
"Nottingham, GB" because the contribution rules say groups are local, invents
precision we do not have and would put a wrong address in front of someone
standing at a station. Better to be ineligible than wrong. The build already
prints a job summary of resolved events; add the count of events missing a
location to it, so the gap is visible and fixable at the fetcher rather than
papered over.

## 5. Tests

### Unit — `tests/unit/` (vitest)

`ics.test.ts`:

- every line ends `\r\n`, including the last
- required properties present, in a valid `BEGIN`/`END` nesting
- folding: no line exceeds 75 octets; unfolding with `unfoldIcsLines()`
  reproduces the original values (round-trip against our own reader)
- folding never splits a multi-byte UTF-8 sequence (title with `—` and an
  emoji, asserted byte-wise)
- escaping of `,` `;` `\` and newlines in `SUMMARY`/`DESCRIPTION`/`LOCATION`
- **the chokepoint invariant**, two ways: a title containing
  `\r\nBEGIN:VEVENT\r\nSUMMARY:evil` produces exactly one `VEVENT` and no
  injected property; and *every* line of the output either opens a property
  or is a fold continuation, which catches a raw line added later without
  anyone having thought to test the value it carried. The `line()` helper is
  what makes both true — these are regression pins on it, not the thing
  preventing the problem
- the same attempt through a **non-TEXT** value (a `url` containing
  `\r\nSUMMARY:evil`) is contained too, by removal rather than escaping
- `UID` identical across two builds of the same event, distinct across events
- UTC formatting, and `DTEND` = start + 120 minutes when no end is known
- unknown location omits `LOCATION` entirely rather than emitting an empty one
- a URL containing a comma survives `URL:` unescaped (the non-TEXT path) while
  the same comma in `SUMMARY:` is escaped — the two value types cannot be
  collapsed into one rule, and this is the test that says so
- `DTSTAMP` comes from the injected `now`

`calendar-links.test.ts`:

- Google URL: correct host/path, `dates` in `YYYYMMDDTHHmmssZ/YYYYMMDDTHHmmssZ`,
  parameters encoded (a title with `&` and a newline survives a
  `new URL()` round-trip)
- Outlook URL: ISO `startdt`/`enddt`, required `path`/`rru` params
- both apply the same 120-minute fallback as the ICS builder — asserted
  against `buildEventIcs` output so the two cannot drift
- `icsPathFor()` is stable for a given event and unique across events

`structured-data.test.ts`:

- output is JSON-serialisable and has `@context: https://schema.org`
- one `Event` per upcoming event, one `Organization` per group regardless of
  event count, and every `organizer.@id` resolves to a node in the graph
- `location` present when the fixture has one, absent (not `null`, not `""`)
  when it does not
- an empty `next-events` map yields no block at all rather than an empty list

`next-events-shape.test.ts`:

- entries lacking `end`/`location` — i.e. a generated file from before this
  change — still produce a valid ICS, valid links, and a valid graph. This is
  the backwards-compatibility pin: the file is gitignored and regenerated, so
  a dev on an old copy must not hit a crash.

### Integration — `tests/integration/` (vitest)

`calendar-export.test.ts`: run the real `fetch-next-events.mjs` parsing
helpers over recorded fixture payloads (a meetup.com event page's JSON-LD, a
Luma ICS body, an Eventbrite `__NEXT_DATA__` blob) and assert the widened
shape comes out — no network, same subprocess-against-fixtures approach as
`process-suggestion.test.ts`.

### Browser — `tests/calendar.spec.ts` (Playwright)

- every card with a next event has an `.add-to-calendar` control with three
  links
- the `.ics` link returns **200** and a body starting `BEGIN:VCALENDAR`.
  Deliberately no content-type assertion here: locally that would only be
  reading back `serve-dist.mjs`'s own `TYPES` map, which proves nothing about
  what visitors get. The `text/calendar` claim is checked where it is real —
  against the published host, in `check-live-site.mjs` (§6)
- `time.dt-start[datetime]` matches the card's `data-next-event-date`
- the page's JSON-LD parses and contains one `Event` per rendered next event
- **with `javaScriptEnabled: false`**: the `<details>` menu still opens and
  all three links are present and correct — the progressive-enhancement claim,
  enforced
- no console errors on load

### Compatibility — how "supported calendars" gets verified

Automated round-tripping proves we produce what we think we produce; it does
not prove Apple Calendar accepts it. Two tiers, and this implementation only
ever had access to the first:

- **Automated, and done.** `ical.js` (MIT, no further dependencies of its
  own) is a devDependency purely for `tests/unit/ics.test.ts`'s third describe
  block, which parses `buildEventIcs()`/`buildIcs()` output with it instead of
  our own reader — removing the "our parser agrees with our writer"
  circularity the in-house `unfoldIcsLines`/`unescapeIcsValue` round-trip
  still has. It confirms: `SUMMARY`/`UID`/`DTSTART`/`DTEND`/`LOCATION` parse to
  the exact values given, including a folded multi-byte title and a
  comma-escaped venue; the chokepoint's injection resistance holds against an
  independent parser, not just our own; and a multi-event `VCALENDAR` yields
  exactly the right number of `VEVENT`s. This is real evidence the file is
  well-formed RFC 5545 — `ical.js` is used by real calendar software (it's
  Mozilla's own parser, originally written for Lightning/Thunderbird), so a
  file it accepts is meaningfully more likely to be accepted elsewhere too.
- **By hand, on real devices — not done, and not doable from here.** This
  plan was executed by an agent in a headless container with no access to
  Apple Calendar, Outlook desktop, Thunderbird, or an Android phone; claiming
  that pass would mean fabricating results nobody produced. This step is
  still real work and still owed before calling the feature done: pull a
  generated `.ics` URL from a deployed preview and, per client, subscribe or
  import a downloaded copy and confirm title/time/venue/end-time all show up
  correctly:
  - [ ] Apple Calendar — macOS
  - [ ] Apple Calendar — iOS (confirm the file opens *in* Calendar, not as a
    text download — this is what a correct `Content-Type: text/calendar`
    header decides, already covered by `scripts/serve-dist.mjs`'s mapping
    and, on the published site, by GitHub Pages' own MIME table)
  - [ ] Google Calendar — both the "Download .ics" import and the
    Google Calendar template link from the card
  - [ ] Outlook desktop (Windows or Mac) — the strictest client on CRLF and
    folding; the most likely to surface a real bug the automated checks missed
  - [ ] Outlook Web — the template link from the card
  - [ ] Thunderbird
  - [ ] Android — Google Calendar and, if available, Samsung Calendar (the
    other MIME-sensitive platform alongside iOS Safari)
  - [ ] one file through an external validator (e.g. icalendar.org's) as a
    second independent opinion beyond `ical.js`
  
  Whoever picks this up: check off each row in this file as it's done, so the
  gap between "automated confidence" and "verified everywhere claimed" stays
  visible rather than silently assumed closed.

## 6. Everything else that has to change

- `src/pages/index.astro` — use `loadNextEvents()`, render the JSON-LD block,
  pass the slug down to `MeetupCard` for `icsPathFor()` (the `id` prop is
  already the slug).
- `scripts/serve-dist.mjs` — `.ics` → `text/calendar; charset=utf-8`.
- `scripts/check-live-site.mjs` — add a check that the published
  `/events.ics` (or one card's `.ics`, if the site feed is dropped) returns
  200 with `text/calendar` and contains at least `MIN_NEXT_EVENTS` `VEVENT`s.
  The monitor is where "the feature quietly stopped working" is supposed to
  be caught, and this feature degrades exactly the way the next-event data
  does: silently.
- `.github/workflows/*` — nothing. The `unit` job already runs the new vitest
  files, `test` the new spec.
- `package.json` — **bump the minor version to 2.2.0**; without it the merge
  deploys but cuts no release.
- `README.md` — a row in the plans table pointing here, and a line in the
  file-map for `src/lib/`.
- `CLAUDE.md` — a short section on the calendar pipeline once it exists,
  describing the same seam this plan describes: generated JSON → `src/lib/ics.mjs`
  → endpoint + card links, with the note that the ICS reader in
  `fetch-next-events.mjs` and the writer are now the same module.

## Rejected alternatives

- **Client-side Blob/`data:` generation.** Kills the no-JS path, and
  `download` on a blob URL is blocked or silently ignored in several in-app
  browsers (the ones people open links from). Build-time files are simpler
  and more compatible.
- **An off-the-shelf add-to-calendar web component.** Ships a framework-shaped
  runtime and a dependency tree into a five-dependency static site whose
  entire client JS budget is four inline scripts.
- **Microdata (`itemscope`/`itemprop`) instead of JSON-LD.** Clutters the
  markup and goes stale when the hero rewrites its own DOM.
- **Only a site-wide `events.ics`.** Does not answer the request: the export
  is wanted per card.
- **A per-group subscription feed.** We only ever resolve the *next* event
  per source, not the series, so a per-group feed would contain one entry and
  pretend to be a calendar.

## Risks

- **Third-party text lands in a structured format.** Titles and venues come
  from scraped feeds. Handled by construction rather than by vigilance: the
  single `line()` helper above is the only thing that can emit an ICS
  line, so the risk reduces to keeping it that way — a review point for any
  later change to `ics.mjs`, and pinned from the outside by the
  every-line-is-a-property assertion in §5. Same applies to the
  JSON-LD block — it is serialised with
  `JSON.stringify`, never string-concatenated, and rendered with
  `set:html` on a `<script type="application/ld+json">`, with `<` in any
  value escaped to `\u003c` so a scraped title containing `</script>` cannot
  close the element early.
- **Eventbrite's `__NEXT_DATA__` venue path is undocumented** and may move.
  The fetcher already treats every source as best-effort; a missing venue
  degrades to no `LOCATION`, which is handled.
- **URL churn.** A rescheduled event changes its `.ics` URL and the old one
  404s. Acceptable: links are only ever rendered from current data, and the
  alternative (index-based names) serves a *different* event under a
  bookmarked URL, which is worse.
- **All-day events.** Every current source yields a timed event. If one ever
  yields a date with no time, it should be emitted as `VALUE=DATE` rather
  than midnight UTC — not built now, but the ICS builder should branch on a
  `allDay` flag rather than making that hard to add later.

## Order of work

1. Widen `fetch-next-events.mjs` (end time + location, per source) and the
   generated-file shape; fixtures captured for the integration test.
2. `src/lib/ics.mjs` — writer, plus the reader moved out of the fetch script;
   `ics.test.ts` alongside it.
3. `src/lib/calendar-links.mjs` + `structured-data.mjs` + `next-events.mjs`,
   with their tests.
4. The `.ics` endpoint, together with the `serve-dist.mjs` MIME entry so
   local serving matches production from the start, and `ls dist/calendar/`
   to confirm the emitted filenames.
5. Card markup: h-event, `<time datetime>`, the `<details>` menu, the icon,
   the styles, the print rule; the same for `NextUpHero` including
   `promote()`.
6. JSON-LD in `index.astro`.
7. `tests/calendar.spec.ts`, the `ical.js` cross-parse in `ics.test.ts`, then
   the by-hand device pass — the one part of this plan that needs a human at
   a real device, tracked as a checklist in this file rather than assumed
   done.
8. Optional `events.ics` + footer subscription link + the monitor check.
9. Docs (`README.md`, `CLAUDE.md`), version bump, `npm run test:all` and
   `npm run build` before the PR.
