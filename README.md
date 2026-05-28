# Timezone Work Map

Interactive world map showing how “late” your local **9:00–17:00** work hours feel in each IANA timezone. Darker red = more of your workday falls in evening or early-morning hours in that zone (DST-aware).

## Quick start

```bash
cd ~/Documents/code/timezoneApp
npm install
npm run data:build   # downloads countries + timezone boundaries (~50MB download once)
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). Use the panel to pick your timezone, or pass `?tz=America/New_York`.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server |
| `npm run build` | Production build to `dist/` |
| `npm run data:build` | Refresh `public/data/` from upstream sources |
| `npm run preview` | Serve production build |

## Map data

`npm run data:build` produces:

- `public/data/countries-110m.json` — [world-atlas](https://github.com/topojson/world-atlas) countries (TopoJSON)
- `public/data/timezones.simplified.geojson` — simplified [timezone-boundary-builder](https://github.com/evansiroky/timezone-boundary-builder) polygons (`tzid` = IANA id)
- `public/data/timezone-index.json` — sorted list of timezone ids for the panel

Raw downloads are cached in `.geo-cache/` (gitignored). The TBB zip ships `combined.json`; the script simplifies with Turf (`tolerance: 0.05`).

To skip re-downloading: `SKIP_TZ_DOWNLOAD=1 npm run data:build`

## How coloring works

For your selected timezone, the app takes **today’s** 9:00–17:00 in that zone, steps in 15-minute increments, converts each instant to every other zone’s local clock, and scores the fraction of steps that fall in “late” hours (before 6:00 or from 18:00 onward). Score `0` → light fill; `1` → dark red (`d3-scale-chromatic` `interpolateReds`).

## Stack

- React 19 + TypeScript + Vite
- D3 (`d3-geo`, `d3-zoom`, `d3-selection`, `d3-scale-chromatic`)
- Luxon (IANA + DST)
- topojson-client

## Attribution

- Country boundaries: [Natural Earth](https://www.naturalearthdata.com/) via [world-atlas](https://github.com/topojson/world-atlas)
- Timezone boundaries: [timezone-boundary-builder](https://github.com/evansiroky/timezone-boundary-builder) © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors
- Timezone rules: [IANA Time Zone Database](https://www.iana.org/time-zones) via Luxon
