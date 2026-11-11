# Foxhole War Stats

A static site that records the current Foxhole World Conquest from the official
[War API](https://github.com/clapfoot/warapi) and keeps a history of every war it has seen.

- **Current war** (`site/index.html`): victory towns, casualties per hour, rocket sites,
  launch targets and impacts, per-region table.
- **War archive** (`site/wars.html`): winner, duration, casualties and rocket launches
  for each recorded war.

## How it works

```
GitHub Actions (every 15 min) ──> War API ──> data branch (JSON) <── browser (GitHub Pages)
```

1. `.github/workflows/collect.yml` runs `collector/collect.mjs` at minutes 7, 22, 37 and 52.
   It requests `/worldconquest/war`, the map list, and each region's war report and public
   dynamic map data, sending `If-None-Match` so unchanged data comes back as `304`.
2. The collector writes compact summaries to the `data` branch:
   - `<shard>/latest.json`: the newest snapshot, per region
   - `<shard>/index.json`: one summary row per war
   - `<shard>/wars/<n>.json`: war metadata and rocket events
   - `<shard>/samples/<n>/<YYYY-MM-DD>.json`: one row per check, one file per day
3. `.github/workflows/pages.yml` deploys `site/` to GitHub Pages only when the site code
   changes. The pages read data from `raw.githubusercontent.com`, so data commits never
   trigger a Pages build.

## Limits

- The War API has no history and no per-faction player counts. This site shows only what
  the collector has recorded since it started, and has no population numbers.
- Rocket counts come from new Rocket Target (launch) and Rocket Ground Zero (impact) icons
  seen at 15-minute intervals. Icons that appear and vanish between checks are missed, so
  counts are a lower bound. A target icon's team is taken as the launching faction.
- GitHub may delay or skip scheduled runs under load; the archive shows coverage per war.

## Run locally

```bash
node collector/collect.mjs site/data
python -m http.server 8765 --directory site
```

Then open http://localhost:8765. Requires Node 18 or newer.

## Credits

Data from the Foxhole War API by Siege Camp. This project is not affiliated with Siege Camp.
Built with help from Claude by Anthropic.
