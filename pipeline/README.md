# Data pipeline

```sh
npm run pipeline -- [layer ids... | all] [options]
```

| Option | Use |
| --- | --- |
| `all` (default) | Every layer in an enabled state |
| `--counties=A,B` | Only these counties (parcels); for local runs |
| `--bbox=w,s,e,n` | Only this area (any layer, including the basemap) |
| `--force` | Publish even if the feature count dropped more than 10% |
| `--no-manifest` / `--manifest-only` | Split publishing across parallel CI jobs |
| `--list` | Print enabled layer ids as JSON |

Without `S3_BUCKET` set, output goes to `apps/web/public/tiles/`. With it, output goes to that bucket
(see the root README).

## States

`sources/<state>/state.yaml` names the state, its bounding box (which the basemap covers), and whether it's
`enabled`. Every other YAML in the folder is one layer, with id `<kind>-<state>`. You can run a layer in a
disabled state by naming it, e.g. `npm run pipeline -- parcels-mt --counties=Gallatin`.

| State | Layer | Parcels | Owner names | Status |
| --- | --- | --- | --- | --- |
| North Carolina | `parcels-nc`, `gamelands-nc` | 5.94M | yes | enabled |
| Wisconsin | `parcels-wi` | 3.57M | yes | configured, review terms |
| Virginia | `parcels-va` | 4.17M | no (boundaries + parcel ID) | configured, review terms |
| Arkansas | `parcels-ar` | 2.15M | yes | configured, review terms; partial coverage |
| Montana | `parcels-mt` | 921k | yes | configured, review terms |

Other states with free statewide parcels worth checking next: Washington, Florida, Utah, Massachusetts,
Minnesota, Oregon, and New York (36 counties so far).

### Adding a state

1. Find a statewide parcel layer on an ArcGIS REST server that supports pagination and GeoJSON (check
   `<layer url>?f=json`). The pipeline doesn't read file downloads yet.
2. Create `sources/<code>/state.yaml` with `name`, `bbox`, and `enabled: false`.
3. Create `sources/<code>/parcels.yaml`: copy another state's file, then set `url`, `countyField`,
   `idField`, and map the source fields onto the shared schema below.
4. Try a county: `npm run pipeline -- parcels-<code> --counties=<one county>`, then tap parcels in the app.
5. Read the state's data terms. Once redistribution as map tiles is allowed, set `enabled: true`.

State game lands or wildlife management areas follow the same pattern with `kind: gamelands`.

## Shared schemas

Every source maps its fields onto these; the app only knows these names. Leave out fields a source lacks.

**parcels:** `parcel_id`, `owner`, `owner2`, `mail_address`, `site_address`, `acres`, `total_value`,
`land_value`, `use`, `legal`, `sale_date`, `county`

**gamelands:** `name`, `tract`, `type`, `owner`, `status`, `days`, `target_shooting`, `acres`, `county`,
`region`; plus `regulations:` (a link to the official rules) at the top level of the YAML

**publicland:** `name`, `access` (PAD-US codes `OA`/`RA`/`XA`/`UK`), `category`, `manager_type`, `manager`,
`designation`, `acres`

Field specs are a source field name, or a template like `"{mailadd}, {mcity} {mstate}"` whose empty parts
are dropped. `values:` remaps spelling variants of a field's values.
