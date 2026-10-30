# Open Hunt Map

A free, open-source web map for hunters and anyone who needs land info: who owns the land, where you can
legally hunt, and maps that work offline. No subscription, self-hostable, open data only.

Coverage: North Carolina statewide, with more states configured and waiting on a terms review
(see [pipeline/README.md](pipeline/README.md)). Project spec:
[Open Hunt Map — Project Spec](https://claude.ai/artifact/RZKZxBEDZHGdAJNL3xsgUE).

> Boundaries are approximate and not a legal survey. Posted signs and current regulations always win.
> You are responsible for getting permission to enter private land.

## How it fits together

```
government ArcGIS services ──► pipeline (GitHub Actions, weekly) ──► tile bucket (Cloudflare R2)
Protomaps planet build    ──►   fetch, normalize, tippecanoe        .pmtiles + manifest.json
                                                                          │  HTTP range requests
                                    Vercel (static PWA) ◄── browser ──────┘
```

The app is a static site; all map data is static PMTiles files read with range requests, so there's no
tile server. Statewide parcels are gigabytes, so they live in a bucket, not on Vercel.

## Local development

Requires Node 22+.

```sh
npm install
npm run data:sample   # Carteret + Craven parcels, NC game lands, coastal PAD-US and basemap
npm run dev           # http://localhost:5173
```

The sample fits the pipeline's built-in tiler, which runs anywhere. Whole states need
[tippecanoe](https://github.com/felt/tippecanoe) (Linux, macOS, or WSL), which CI provides.

## Deploying

### 1. Tile bucket (Cloudflare R2)

1. Create an R2 bucket and connect a custom domain (or enable its public `r2.dev` URL).
2. Set CORS on the bucket from [infra/r2-cors.json](infra/r2-cors.json), with your Vercel domain in
   `AllowedOrigins`. PMTiles needs `range` allowed and `etag` exposed.
3. Create an R2 API token with read/write access to the bucket.

Any S3-compatible store works the same way.

### 2. Data pipeline (GitHub Actions)

Add these repository secrets, then run **Actions → Data pipeline → Run workflow** once. After that it runs
every Monday.

| Secret | Example |
| --- | --- |
| `S3_ENDPOINT` | `https://<account id>.r2.cloudflarestorage.com` |
| `S3_BUCKET` | `open-hunt-map-tiles` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | from the R2 API token |

Each enabled layer builds in its own job (NC parcels take the longest, roughly 1–2 hours), then a final job
rebuilds `manifest.json`. A failed layer keeps serving its previous version.

### 3. App (Vercel)

1. Import the repository in Vercel. Leave the root directory as the repo root; [vercel.json](vercel.json)
   sets the install, build, and output settings.
2. Add the environment variable `VITE_TILES_URL` = your bucket's public URL (e.g. `https://tiles.example.com/`).
3. Deploy.

To publish from your own machine instead of CI, set the same `S3_*` variables and run
`npm run pipeline -- <layer id>`.

## Layout

```
apps/web/          Vite + React + TypeScript PWA, MapLibre GL JS + PMTiles
pipeline/          Fetch -> normalize -> tile -> validate -> publish
pipeline/sources/  One folder per state (plus us/ for national layers), one YAML per layer
infra/             Bucket CORS config
.github/workflows/ Scheduled data pipeline
```

Planned, per the spec: `apps/api/` (owner search and optional sync) and per-county offline downloads.

## Data sources

| Layer | Source | License |
| --- | --- | --- |
| NC parcels | [NC OneMap statewide parcels](https://services.gis.nc.gov/secure/rest/services/NC1Map_Parcels/MapServer) | Free; [NC OneMap disclaimer](https://it.nc.gov/documents/gicc/gicc-nconemap-disclaimer-20220511pdf/open) |
| NC game lands | [NCWRC game lands (detail)](https://services1.arcgis.com/YfqBAUM5nWR3yhGP/ArcGIS/rest/services/gamelands_detail/FeatureServer/22) | Free; boundaries approximate |
| Public land (national) | [USGS PAD-US public access](https://services.arcgis.com/v01gqwM5QqNysAAi/ArcGIS/rest/services/PADUS_Public_Access/FeatureServer/0) | Public domain |
| Basemap | OpenStreetMap via [Protomaps](https://protomaps.com) | ODbL, attribution required |

## License

Code: [AGPL-3.0](LICENSE). Anyone running a modified hosted copy must publish their changes.
Documentation: CC BY 4.0. Each data layer keeps its own terms, shown in the app.
