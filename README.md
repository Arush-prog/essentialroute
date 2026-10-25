# EssentialRoute · Mumbai

Flood-aware navigation and essential-service access analysis for Mumbai.
GeoAI IIT Bombay Hackathon prototype — React 19 + TypeScript + Leaflet, installable PWA, mobile-first.

> Prototype. Not a substitute for official emergency instructions. In an emergency call **112**.

---

## Run it

Requires Node.js 18+.

```bash
npm install
npm run dev        # http://localhost:5173  (live reload)
npm run build      # production build → dist/
npm run preview    # serve dist/ at http://localhost:4173
npm run typecheck  # strict TypeScript check
```

No API keys and no environment variables are needed. All services are free, keyless public endpoints.

### Demo on a phone (GPS needs HTTPS)

Browsers only share location with secure pages (`https://` or `localhost`). For a phone:

1. `npm run build`
2. Deploy the `dist/` folder to any HTTPS static host — e.g. drag `dist/` onto **app.netlify.com/drop**, or `npx vercel dist`.
3. Open the URL on the phone → **Add to Home Screen** for the full-screen app.

A prebuilt `dist/` is included, so step 1 is optional.

---

## What's real vs. simulated

| Feature | Source | Status |
|---|---|---|
| Map | OpenFreeMap vector tiles drawn with MapLibre GL (sharp on every phone); falls back to OpenStreetMap raster tiles if WebGL or the vector host is unavailable | **Real**, keyless |
| Live rainfall | Open-Meteo hourly precipitation at 11 known waterlogging spots + city centre (weather model, ~10 km grid) | **Real**, keyless, refreshed every 10 min |
| Rain radar overlay | RainViewer public radar (max zoom 7, coverage over India may be patchy) | **Real**, optional |
| Rain-risk zones | Rule-based estimate: live (or simulated) rainfall × known waterlogging spots | **ESTIMATE** — labelled “RAIN-RISK”, not observed flooding |
| Turn-by-turn navigation | OSRM steps + device GPS; voice via the phone's built-in speech engine | **Real**; remaining time is the engine's free-flow estimate |
| Search autocomplete | Photon (komoot) over OSM — Mumbai Metropolitan Region first, wider India second | **Real** |
| Reverse geocoding ("My location · Linking Road") | Nominatim, single lookups, ≤1 req/s | **Real** |
| Routes, alternatives, distance, duration, directions | OSRM (FOSSGIS car/foot; OSRM demo as car fallback) | **Real** — free-flow times, **no live traffic** |
| Live location (blue dot, accuracy ring) | Browser `watchPosition()` | **Real device GPS** — never simulated |
| Hospitals, clinics, rail/metro stations, police, fire | OpenStreetMap via Overpass | **Real**, only OSM tags shown (no invented phones/hours) |
| Road network for analysis | OSM major roads via Overpass | **Real geometry and topology** |
| Flood zones | Created by the user, or the "illustrative scenario" preset | **SIMULATED** — labelled everywhere |
| Waterlogging reports | Entered by the user, stored on that device only | **USER-REPORTED, unverified**; stale after 6 h |
| Live flood sensors / official closures / rainfall | — | **Not connected.** The app says so rather than inventing data |

The illustrative scenario places zones at approximate locations of junctions widely reported as recurrent waterlogging spots (Hindmata, King's Circle, Milan Subway, Andheri Subway, Sion, Kurla). It is a scenario, not a statement about current conditions.

---

## The GeoAI method (deterministic, reproducible)

No trained ML model is used. The analysis is geospatial computation and graph algorithms.

**Flood model.** Zones are circles. A road segment is *affected* when it geometrically intersects a circle (exact segment–circle clipping in a local planar projection).

| Severity | Effect inside zones |
|---|---|
| Low | Passable · travel-time ×1.5 |
| Moderate | Passable · travel-time ×3 |
| High | Impassable |
| Extreme | Impassable · zones 35% wider |

**Flood-aware routing — recommends the *safest* route** (`src/analysis/floodRouting.ts`)
1. Request the fastest route plus alternatives from OSRM and score each against the active zones (*blocked* if it crosses an impassable zone; otherwise duration + penalty for time inside passable zones).
2. If none is clean, try detour waypoints on a ring around the first flooded zone (12 bearings, off the flooded corridor) and re-score. Meanwhile the Mumbai major-road graph downloads in the background.
3. Still not clean → **A\*** on the road graph with impassable roads removed and passable (low/moderate) flood roads heavily penalised. The A\* path is turned into a **real OSRM route** by requesting the engine through waypoints along it (denser near flood zones) — so distance, time and turn-by-turn all come from the engine.
4. Ranking: clean routes first (fastest of those, within 3× the fastest time), then least exposure; impassable routes last and shown for reference only.
5. The UI shows *Safest* vs *Fastest* side by side (time, distance, which zones the fastest crosses, the extra cost of going safe). If every route is impassable it says so rather than inventing one.

**Accessibility / isolated communities** (`src/analysis/accessibility.ts`)
- The Mumbai major-road network (motorway → tertiary) becomes a graph using shared OSM node IDs.
- Multi-source **Dijkstra** from every service of the chosen type gives road distance to the nearest one — once normally, once with flooding.
- Each of 28 sample zones (1.2 km circle around an approximate neighbourhood centre) is judged on *all* its road nodes, so one failed path never flags a whole area:
  - **No calculated route** — no node can reach any service.
  - **Reduced** — median distance +30% and ≥500 m, or ≥25% of nodes lose access.
- Summary counts (segments affected, services harder to reach, zones reduced / cut off) are computed live from loaded data. If data can't load, an error is shown — never placeholder numbers.

**Limitations (also shown in-app).** Graph excludes residential streets, one-way rules and turn restrictions; distances are road length, not time; sample zones are not ward boundaries and carry no population data.

---

## Navigation (Start)

- **Start** navigates from where you are (like Google Maps): if you are away from the route's start, it re-plans from your GPS position — flood- and rain-aware.
- Green turn banner (distance to the next turn + instruction, then the turn after), remaining time / distance / arrival time, voice prompts (mute button), screen kept awake.
- Off the route for two fixes in a row → automatic safe re-route. If rain or flood zones change mid-trip, the route updates and you are told why.
- **Preview turns** steps through every instruction without GPS.
- **Demo drive** plays the route with a SIMULATED position (labelled “DEMO DRIVE · simulated position” on screen) so navigation can be shown indoors where GPS is weak. Real GPS is switched off during the demo; flood/rain re-routing still works mid-drive.
- **Direction arrow** turns with the phone like Google Maps: tilt-compensated compass when standing/walking, GPS direction of travel when driving (> 18 km/h), road direction otherwise; smoothed so sensor noise doesn't make it wobble. Android: works without a prompt. iPhone: asks for motion access on first tap.
- The route line, its flood sections and direction arrows are drawn inside the vector map engine, so they stay locked to the roads while panning and pinch-zooming (SVG overlay only on the raster fallback).
- On arrival: “You have arrived at your location” card with the destination, distance and trip time (plus whether all flood zones were avoided), a voice announcement and a vibration; navigation stays put until Done.
- Android extras: double vibration at each turn, “Install EssentialRoute” button (home-screen app, full-screen), landscape layout for car mounts.
- Android back button ends navigation.

## Rain-aware routing (Flood tab → Rain)

- **Live** (default): real rainfall at 11 frequently reported waterlogging spots (approximate locations). Risk per spot — rate now OR last 3 h: Low ≥4 mm/h or ≥10 mm; Moderate ≥10 / ≥25; High ≥25 / ≥60 (impassable); Extreme ≥50 / ≥120. Subways move up one level (they flood first). Thresholds are anchored on Mumbai's commonly cited ~25 mm/h storm-drain design capacity; they are an illustrative rule, not a hydrological model.
- **Moderate / Heavy / Extreme**: simulated rain levels for planning (clearly marked as simulated).
- **Off**: rain ignored. Custom flood zones (place your own, any severity) sit under *Flood zones*.

## Live GPS behaviour

- Tracking starts only after a tap (“Use my location” or the locate button), via `watchPosition` with high accuracy; cleared on stop and on unmount.
- Blue dot + accuracy circle update in place without changing zoom. “Recenter on me” uses the latest fix.
- Status chip reports truthfully: *Live location active ±m · time*, *Low accuracy*, *Position may be outdated*, *Denied*, *Needs HTTPS*, *Unavailable*.
- **Live origin mode:** the route origin follows you; re-routing happens only after moving ≥150 m with accuracy ≤100 m and ≥20 s since the last route (no request spam on GPS noise). Tap the origin chip to freeze it as a fixed point. Manual origins are never overwritten by GPS.
- Positions are kept in memory only — never stored or uploaded except as coordinates to the routing/address services when a route is requested.
- Browsers may pause tracking when the app is in the background.

---

## Project structure

```
src/
  config.ts              endpoints, Mumbai bounds, GPS thresholds
  types.ts
  lib/                   geo maths (haversine, segment–circle clip), polite HTTP (rate limit, cache, timeouts)
  services/              geocoding (Photon/Nominatim), routing (OSRM), overpass (services, road network)
  analysis/              flood model, flood-aware planner, road graph (Dijkstra, A*, components), accessibility
  hooks/useGeolocation   watchPosition lifecycle
  state/                 store + actions + reactive controller (auto-route, live origin, re-score on flood change), navigation
  services/weather       Open-Meteo rainfall + RainViewer radar
  analysis/rain          rain → waterlogging-risk rules, hotspot list
  map/                   Leaflet map (imperative, layer per concern), vector basemap bridge (MapLibre), icons, clustering
  components/            search/autocomplete, route sheet, Explore, Flood Analysis, Alerts, shell
public/                  manifest, service worker (app shell only — never caches routes or flood data), icons
scripts/                 esbuild dev/build/preview
```

Add `?debug=1` to the URL to expose `window.__essentialroute.getState()` for inspection.

## Usage policies respected

Requests are debounced, cached and rate-limited per host (Photon 350 ms, Nominatim/OSRM/Open-Meteo/RainViewer 1 s, Overpass 2 s). Open-Meteo and RainViewer free tiers are for non-commercial / educational use — fine for a hackathon; a commercial launch needs their paid plans. Nominatim is not used for autocomplete (its policy forbids it). Tile and data attribution is shown on the map. The OpenStreetMap tile servers are for light use — for production traffic put a keyed tile provider first in `TILE_SOURCES` (`src/config.ts`). For heavy or production use, self-host OSRM/Photon/Overpass or use a commercial provider — endpoints are centralised in `src/config.ts`.
