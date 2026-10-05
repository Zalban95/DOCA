# Experiment: publish packs for other hubs, and fetch theirs

**Flag:** `experiments.packRegistry` (Settings → Experiments), off by default. **TODO:** H4.6. **Since:** 2.198.0.

## Hypothesis

Packs move between hubs one push at a time (send, since 2.194.0). A registry turns that around: a hub publishes what it
wants to share, and any hub its owner gave a read token to browses the list and fetches what it wants — a team's or a
customer's shared shelf, with no third-party service in between, and nothing applied anywhere without a host's dry run.

## What happens when it is on

1. **Publishing hub**: a host marks library packs *Published*. A device token with the **registry** preset
   (`packs:read`, nothing else) may list them (`GET /api/v1/packs/published`) and download one. With the flag off the
   routes answer 404, and unpublished packs are never listed or served.
2. **Fetching hub**: a host adds the other hub with that token (Settings → Packs → other hubs; pinned on first contact,
   as for sending), then **Browse** lists what it publishes and **Fetch** puts one in this library, marked as from that
   registry. Bringing it in is the usual dry run.

## Measured

What matters is whether people use it rather than how fast it is: how many packs get published, fetched and then
actually brought in (the library records each one's origin), over a few weeks of two hubs sharing.

| Date | Hubs | Published | Fetched | Brought in | Notes |
|---|---|---|---|---|---|
| — | — | — | not measured yet: needs two hubs that share | — | — |

## Cost

Nothing until a host publishes something; then one list request per browse and one download per fetch.

## Risks

- **Publishing more than meant**: a pack may carry memory or rules. Publishing is per pack, a host's click, and
  `pack.json` lists what is inside; secrets never travel in a pack (they are emptied and listed as needs).
- **A token that leaks** reads only what is published, and is revoked like any device.

## Rollback

Switch the flag off: the routes answer 404 and the Publish/Browse buttons go; published marks stay on the packs, harmless.
