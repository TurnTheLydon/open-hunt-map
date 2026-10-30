// Cut the enabled states out of the latest Protomaps planet build. Only the requested tiles
// are downloaded (HTTP range requests), not the ~140 GB planet. Uses the pmtiles CLI when
// available (it batches ranges, so it's much faster); otherwise reads tile by tile.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { FetchSource, PMTiles } from 'pmtiles';
import { PMTilesWriter } from './pmtiles-writer.mjs';
import { lonLatToTile } from './tile.mjs';
import { findTool } from './tools.mjs';

// regions: [[w, s, e, n], ...]
export async function extractBasemap(source, regions, outPath, log) {
  const builds = await (await fetch(source.builds)).json();
  const latest = builds.at(-1);
  const url = source.buildUrl.replace('{key}', latest.key);

  const bin = findTool('pmtiles');
  if (bin) {
    const regionPath = `${outPath}.region.geojson`;
    const polygons = regions.map(([w, s, e, n]) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]]);
    writeFileSync(regionPath, JSON.stringify({ type: 'MultiPolygon', coordinates: polygons }));
    const args = ['extract', url, outPath, `--region=${regionPath}`, `--maxzoom=${source.maxzoom}`];
    log(`  pmtiles ${args.join(' ')}`);
    const res = spawnSync(bin, args, { stdio: 'inherit' });
    if (res.status !== 0) throw new Error(`pmtiles extract exited with ${res.status}`);
  } else {
    log(`  pmtiles CLI not found; extracting ${url} tile by tile`);
    await extractWithFetch(url, source, regions, outPath, log);
  }
  return { sourceDate: latest.uploaded.slice(0, 10), bbox: union(regions) };
}

function union(regions) {
  return regions.reduce(
    (a, [w, s, e, n]) => [Math.min(a[0], w), Math.min(a[1], s), Math.max(a[2], e), Math.max(a[3], n)],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
}

async function extractWithFetch(url, source, regions, outPath, log) {
  const planet = new PMTiles(new FetchSource(url));
  const header = await planet.getHeader();
  const metadata = await planet.getMetadata();

  const jobs = new Map();
  for (let z = 0; z <= source.maxzoom; z++) {
    for (const [w, s, e, n] of regions) {
      const [x0, y1] = lonLatToTile(w, s, z);
      const [x1, y0] = lonLatToTile(e, n, z);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.set(`${z}/${x}/${y}`, [z, x, y]);
    }
  }
  const queue = [...jobs.values()];
  if (queue.length > 50_000) {
    throw new Error(`${queue.length} tiles is too many to fetch one by one; install the pmtiles CLI or pass --bbox=…`);
  }

  const writer = new PMTilesWriter();
  let done = 0;
  const worker = async () => {
    while (queue.length) {
      const [z, x, y] = queue.shift();
      // The reader decompresses tiles; store them gzipped again.
      const tile = await planet.getZxy(z, x, y);
      if (tile) writer.add(z, x, y, gzipSync(Buffer.from(tile.data)));
      if (++done % 1000 === 0) log(`  ${done}/${jobs.size} tiles`);
    }
  };
  await Promise.all(Array.from({ length: 32 }, worker));
  log(`  ${writer.tiles.length} tiles`);

  writeFileSync(
    outPath,
    writer.finish(
      { minZoom: 0, maxZoom: source.maxzoom, bounds: union(regions), tileType: header.tileType, tileCompression: 2 },
      metadata,
    ),
  );
}
