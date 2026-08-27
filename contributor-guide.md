# Contributing

Nottingham Digital is a community driven resource and welcomes contributions
from all.

To contribute, fork the repository and open a pull request.

## Adding your meetup

Add one YAML file to [`src/content/meetups/`](src/content/meetups), named after
your group (for example `phpminds.yml`):

```yaml
name: PHPMinds
url: https://phpminds.org/
events: https://phpminds.org/
category: tech # tech | design | ops
cadence: Second Thursday
summary: >-
  A PHP user group attracting a mix of local and national speakers each month.
links:
  - label: Mastodon
    url: https://phpc.social/@phpminds
```

| Field | Required | Notes |
| --- | --- | --- |
| `name` | yes | How the group should be listed |
| `url` | yes | Meetup page, or your own site |
| `events` | no | Where your events actually get posted — often the same as `url`, but use a different link if your events feed lives elsewhere (Luma, Meetup, an `/events` page); without it, no next-event date is fetched |
| `category` | yes | One of `tech`, `design`, `ops` |
| `cadence` | yes | Plain English: `First Tuesday`, `Quarterly`, `No regular date` |
| `summary` | yes | A sentence or two |
| `links` | no | Any number of `label` / `url` pairs |

You do not need to run the site locally to add a meetup — the file is all that
is needed. A pull request that adds a malformed file will fail CI with a message
naming the problem.

## Guidelines for event descriptions and titles

1. Link the title to the relevant site or Meetup page.
2. Keep sentences and paragraphs short and easy to scan.
3. Double check your spelling.
4. Feel free to include social media links via the `links` field.
5. Respect other meetups and the community spirit of what we're trying to
   achieve as a collaborative, supportive group of organisers. Refrain from any
   content that is not in keeping with this aim — if further advice is needed,
   raise a comment in your PR.
6. Ensure your meetup is in Nottingham or the immediate area.

## Guidelines for code and markup

1. Commits must be accompanied by meaningful commit messages.
2. PRs that include bug fixing should be accompanied by a step-by-step
   description of how to reproduce the bug.
3. Run `npm run build` before opening a PR — it validates every meetup file.
