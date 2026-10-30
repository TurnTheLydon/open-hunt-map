// Usage: npm run pipeline -- [layer ids... | all] [options]
//   fetch+normalize -> tile -> validate -> publish, per layer in pipeline/sources/<state>/.
//
//   all                 every layer in an enabled state (the default)
//   --counties=A,B      only these counties (parcels), for local runs
//   --bbox=w,s,e,n      only this area (any layer, including the basemap)
//   --force             publish even if the feature count dropped >10%
//   --no-manifest       skip rebuilding manifest.json (parallel CI jobs)
//   --manifest-only     only rebuild manifest.json from published layers
//   --list              print enabled layer ids as JSON (CI matrix)
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fetchArcgis, layerInfo } from './arcgis.mjs';
import { makeNormalizer } from './normalize.mjs';
import { tile } from './tile.mjs';
import { extractBasemap } from './basemap.mjs';
import { publish, validate, writeManifest } from './publish.mjs';
import { enabledRegions, loadSources } from './sources.mjs';
import { storage } from './storage.mjs';
import { DATA_DIR } from './paths.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const has = (name) => args.includes(`--${name}`);
const options = {
  force: has('force'),
  counties: flag('counties')?.split(','),
  bbox: flag('bbox')?.split(',').map(Number),
};
const ids = args.filter((a) => !a.startsWith('--'));
const log = (msg) => console.log(msg);

const sources = loadSources();
const enabled = sources.filter((s) => s.enabled);

if (has('list')) {
  console.log(JSON.stringify(enabled.map((s) => s.id)));
  process.exit(0);
}
if (has('manifest-only')) {
  log(`manifest.json -> ${storage.describe()}: ${(await writeManifest()).join(', ')}`);
  process.exit(0);
}

// Named layers run even in disabled states, so a new state can be tried before enabling it.
const selected = ids.length === 0 || ids.includes('all') ? enabled : sources.filter((s) => ids.includes(s.id));
const unknown = ids.filter((id) => id !== 'all' && !sources.some((s) => s.id === id));
if (unknown.length) {
  console.error(`Unknown layer(s): ${unknown.join(', ')}. Known: ${sources.map((s) => s.id).join(', ')}`);
  process.exit(1);
}

mkdirSync(join(DATA_DIR, 'work'), { recursive: true });
log(`Publishing to ${storage.describe()}`);
let failed = false;

for (const source of selected) {
  const started = Date.now();
  log(`\n${source.id}: ${source.name}`);
  const geojson = join(DATA_DIR, 'work', `${source.id}.geojsonl`);
  const tiles = join(DATA_DIR, 'work', `${source.id}.pmtiles`);
  try {
    if (source.type === 'arcgis') {
      log('fetch');
      const { sourceDate } = await layerInfo(source.url);
      const { transform, stats } = makeNormalizer(source);
      await fetchArcgis(source, geojson, transform, options, log);
      log(`  ${stats.count} features`);
      await validate(source, stats.count, options);
      log('tile');
      await tile(source, geojson, tiles, stats.bbox, log);
      rmSync(geojson);
      log('publish');
      log(`  ${await publish(source, tiles, { sourceDate, features: stats.count, bbox: stats.bbox })}`);
    } else if (source.type === 'protomaps') {
      log('extract');
      const regions = options.bbox ? [options.bbox] : enabledRegions();
      const { sourceDate, bbox } = await extractBasemap(source, regions, tiles, log);
      log('publish');
      log(`  ${await publish(source, tiles, { sourceDate, bbox })}`);
    } else {
      throw new Error(`unknown source type "${source.type}"`);
    }
    rmSync(tiles, { force: true });
    log(`done in ${((Date.now() - started) / 60000).toFixed(1)} min`);
  } catch (err) {
    failed = true;
    console.error(`FAILED ${source.id}: ${err.message}`);
  }
}

if (!has('no-manifest')) log(`\nmanifest.json: ${(await writeManifest()).join(', ')}`);
process.exit(failed ? 1 : 0);
