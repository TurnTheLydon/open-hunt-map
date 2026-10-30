// Tile: build a vector PMTiles file from GeoJSONSeq. Uses tippecanoe when it is on PATH
// (Linux/macOS/CI); otherwise falls back to geojson-vt, which holds the layer in memory
// and suits a few counties for local development, not a whole state.
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import GeoJSONVT from 'geojson-vt';
import vtpbf from 'vt-pbf';
import { PMTilesWriter } from './pmtiles-writer.mjs';
import { findTool } from './tools.mjs';

export async function tile(source, inPath, outPath, bbox, log) {
  const tippecanoe = findTool('tippecanoe');
  if (tippecanoe) return tileWithTippecanoe(tippecanoe, source, inPath, outPath, log);
  log('  tippecanoe not found; using built-in geojson-vt tiler');
  return tileWithGeojsonVt(source, inPath, outPath, bbox, log);
}

// Parcels: drop the smallest lots first at low zoom and simplify shared borders the same
// way on both sides. Other polygons: thin the densest areas, keep detail by adding zooms.
const KIND_ARGS = {
  parcels: ['--drop-smallest-as-needed', '--detect-shared-borders'],
  default: ['--drop-densest-as-needed', '--extend-zooms-if-still-dropping'],
};

// geojson-vt holds every feature and every generated tile in memory.
const BUILTIN_MAX_FEATURES = 400_000;

function tileWithTippecanoe(bin, source, inPath, outPath, log) {
  const { layer, minzoom, maxzoom } = source.tile;
  const args = [
    '-o', outPath, '--force', '-l', layer, '-Z', String(minzoom), '-z', String(maxzoom),
    '--read-parallel', ...(KIND_ARGS[source.kind] ?? KIND_ARGS.default),
    '-n', source.name, '-A', source.attribution, inPath,
  ];
  log(`  ${bin} ${args.join(' ')}`);
  const res = spawnSync(bin, args, { stdio: 'inherit' });
  if (res.status !== 0) throw new Error(`tippecanoe exited with ${res.status}`);
}

async function tileWithGeojsonVt(source, inPath, outPath, bbox, log) {
  const { layer, minzoom, maxzoom } = source.tile;
  const features = [];
  for await (const line of createInterface({ input: createReadStream(inPath) })) {
    if (!line) continue;
    if (features.length >= BUILTIN_MAX_FEATURES) {
      throw new Error(
        `more than ${BUILTIN_MAX_FEATURES} features; install tippecanoe (CI, Linux, macOS, or WSL), ` +
          'or narrow the run with --counties=… or --bbox=…',
      );
    }
    features.push(JSON.parse(line));
  }

  const index = new GeoJSONVT(
    { type: 'FeatureCollection', features },
    { maxZoom: maxzoom, indexMaxZoom: Math.min(maxzoom, 5), indexMaxPoints: 100000, tolerance: 3, extent: 4096, buffer: 64 },
  );

  const writer = new PMTilesWriter();
  const fields = {};
  for (const f of features.slice(0, 1000)) {
    for (const [k, v] of Object.entries(f.properties)) fields[k] = typeof v === 'number' ? 'Number' : 'String';
  }

  // Walk down from the tiles covering the bbox at minzoom, only into children of non-empty tiles.
  const walk = (z, x, y) => {
    const t = index.getTile(z, x, y);
    if (!t || t.features.length === 0) return;
    writer.add(z, x, y, gzipSync(vtpbf.fromGeojsonVt({ [layer]: t }, { version: 2 })));
    if (z < maxzoom) {
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) walk(z + 1, x * 2 + dx, y * 2 + dy);
    }
  };
  const [x0, y1] = lonLatToTile(bbox[0], bbox[1], minzoom);
  const [x1, y0] = lonLatToTile(bbox[2], bbox[3], minzoom);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) walk(minzoom, x, y);
  log(`  ${writer.tiles.length} tiles`);

  const buf = writer.finish(
    { minZoom: minzoom, maxZoom: maxzoom, bounds: bbox, tileType: 1, tileCompression: 2 },
    {
      name: source.name,
      attribution: source.attribution,
      vector_layers: [{ id: layer, fields, minzoom, maxzoom }],
    },
  );
  writeFileSync(outPath, buf);
}

export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [Math.min(Math.max(x, 0), n - 1), Math.min(Math.max(y, 0), n - 1)];
}
