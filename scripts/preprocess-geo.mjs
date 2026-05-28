/**
 * Downloads and preprocesses map data for the timezone work map.
 * Run: npm run data:build
 */
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { createReadStream } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import simplify from '@turf/simplify'
import { geoArea } from 'd3-geo'
import { feature as topoFeature } from 'topojson-client'
import { buildGeoIndexJson } from './geoIndex.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT_DIR = join(ROOT, 'public', 'data')
const CACHE_DIR = join(ROOT, '.geo-cache')

const COUNTRIES_URL =
  'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'

// timezone-boundary-builder release (2025a)
const TZ_ZIP_URL =
  'https://github.com/evansiroky/timezone-boundary-builder/releases/download/2025a/timezones.geojson.zip'

async function download(url, dest) {
  console.log(`Downloading ${url}...`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed ${url}: ${res.status}`)
  await pipeline(res.body, createWriteStream(dest))
}

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true })
}

async function unzip(zipPath, destDir) {
  await ensureDir(destDir)
  execSync(`unzip -o -q "${zipPath}" -d "${destDir}"`, { stdio: 'inherit' })
}

const SPHERE_AREA = 4 * Math.PI

function rewindRing(ring) {
  const ringFeature = { type: 'Polygon', coordinates: [ring] }
  return geoArea(ringFeature) > SPHERE_AREA / 2 ? ring.slice().reverse() : ring
}

function rewindFeature(feature) {
  const { geometry } = feature
  if (geometry.type === 'Polygon') {
    return {
      ...feature,
      geometry: {
        type: 'Polygon',
        coordinates: geometry.coordinates.map(rewindRing),
      },
    }
  }
  if (geometry.type === 'MultiPolygon') {
    return {
      ...feature,
      geometry: {
        type: 'MultiPolygon',
        coordinates: geometry.coordinates.map((polygon) =>
          polygon.map(rewindRing),
        ),
      },
    }
  }
  return feature
}

function simplifyFeature(feature, tolerance) {
  try {
    return simplify(feature, { tolerance, highQuality: false })
  } catch {
    return feature
  }
}

const CITIES_PER_TIMEZONE = 12
const US_CITIES_PER_TIMEZONE = 60
const US_COUNTRY = 'United States of America'

async function buildTimezoneCities() {
  const require = createRequire(import.meta.url)
  const cityTimezones = require('city-timezones')
  const byTz = new Map()
  const usTimezones = new Set()
  const stateToTz = new Map()
  const abbrevToState = new Map()

  for (const entry of cityTimezones.cityMapping) {
    const tzid = entry.timezone
    const name = entry.city?.trim()
    if (!tzid || !name) continue

    let list = byTz.get(tzid)
    if (!list) {
      list = []
      byTz.set(tzid, list)
    }
    list.push({ name, pop: entry.pop ?? 0 })

    if (entry.iso2 === 'US') {
      usTimezones.add(tzid)
      const state = entry.province?.trim()
      if (state) {
        let tzSet = stateToTz.get(state)
        if (!tzSet) {
          tzSet = new Set()
          stateToTz.set(state, tzSet)
        }
        tzSet.add(tzid)
        const abbrev = entry.state_ansi?.trim().toUpperCase()
        if (abbrev && abbrev.length === 2) {
          abbrevToState.set(abbrev, state)
        }
      }
    }
  }

  const out = {}
  for (const [tzid, cities] of byTz) {
    const limit = usTimezones.has(tzid)
      ? US_CITIES_PER_TIMEZONE
      : CITIES_PER_TIMEZONE
    const seen = new Set()
    const sorted = cities
      .sort((a, b) => b.pop - a.pop)
      .filter(({ name }) => {
        const key = name.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, limit)
      .map(({ name }) => name)

    if (sorted.length > 0) out[tzid] = sorted
  }

  const citiesPath = join(OUT_DIR, 'timezone-cities.json')
  await writeFile(citiesPath, JSON.stringify(out))
  console.log(
    `Wrote ${citiesPath} (${Object.keys(out).length} timezones with cities)`,
  )

  const usSearch = {
    country: US_COUNTRY,
    stateToTimezones: Object.fromEntries(
      [...stateToTz.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([state, tzSet]) => [state, [...tzSet].sort()]),
    ),
    stateAbbreviations: Object.fromEntries(
      [...abbrevToState.entries()].sort(([a], [b]) => a.localeCompare(b)),
    ),
  }
  const usSearchPath = join(OUT_DIR, 'us-search.json')
  await writeFile(usSearchPath, JSON.stringify(usSearch))
  console.log(
    `Wrote ${usSearchPath} (${Object.keys(usSearch.stateToTimezones).length} states)`,
  )
}

async function main() {
  await ensureDir(OUT_DIR)
  await ensureDir(CACHE_DIR)

  await buildTimezoneCities()

  // --- Countries ---
  const countriesPath = join(OUT_DIR, 'countries-110m.json')
  await download(COUNTRIES_URL, countriesPath)
  console.log(`Wrote ${countriesPath}`)

  // --- Timezones ---
  const zipPath = join(CACHE_DIR, 'timezones.geojson.zip')
  const rawGeoPath = join(CACHE_DIR, 'combined.json')

  if (!process.env.SKIP_TZ_DOWNLOAD) {
    try {
      if (!(await fileExists(rawGeoPath))) {
        await download(TZ_ZIP_URL, zipPath)
        await unzip(zipPath, CACHE_DIR)
      }
    } catch (e) {
      console.warn('Timezone download failed:', e.message)
      if (!(await fileExists(rawGeoPath))) {
        throw new Error(
          'No timezone data. Place combined.json in .geo-cache/ or fix network.',
        )
      }
    }
  }

  console.log('Reading timezone boundaries (may take a moment)...')
  const raw = JSON.parse(await readFile(rawGeoPath, 'utf8'))
  const tolerance = 0.05 // degrees; tune for size vs detail
  const simplified = {
    type: 'FeatureCollection',
    features: raw.features
      .filter((f) => {
        const tzid = f.properties?.tzid ?? f.properties?.TZID
        return tzid && !tzid.startsWith('Etc/')
      })
      .map((f) => {
        const tzid = f.properties.tzid ?? f.properties.TZID
        const wound = rewindFeature(f)
        const simplifiedFeature = simplifyFeature(wound, tolerance)
        return {
          ...simplifiedFeature,
          properties: { tzid },
        }
      }),
  }

  const tzOut = join(OUT_DIR, 'timezones.simplified.geojson')
  await writeFile(tzOut, JSON.stringify(simplified))
  console.log(
    `Wrote ${tzOut} (${simplified.features.length} features, ${(JSON.stringify(simplified).length / 1024 / 1024).toFixed(2)} MB)`,
  )

  const tzids = [...new Set(simplified.features.map((f) => f.properties.tzid))]
    .sort()
  const indexPath = join(OUT_DIR, 'timezone-index.json')
  await writeFile(indexPath, JSON.stringify(tzids, null, 0))
  console.log(`Wrote ${indexPath} (${tzids.length} zones)`)

  console.log('Building country–timezone index…')
  const topology = JSON.parse(await readFile(countriesPath, 'utf8'))
  const countryFc = topoFeature(topology, topology.objects.countries)
  const countries = countryFc.features
    .filter((f) => f.properties?.name)
    .map((f) => ({
      ...f,
      properties: { name: String(f.properties.name) },
    }))
  const geoIndex = buildGeoIndexJson(countries, simplified.features)
  const geoIndexPath = join(OUT_DIR, 'geo-index.json')
  await writeFile(geoIndexPath, JSON.stringify(geoIndex))
  console.log(
    `Wrote ${geoIndexPath} (${geoIndex.pairs.length} pairs, ${Object.keys(geoIndex.primaryCountryByTz).length} zones)`,
  )

  try {
    await unlink(zipPath)
  } catch {
    /* ignore */
  }
}

async function fileExists(p) {
  try {
    await readFile(p)
    return true
  } catch {
    return false
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
