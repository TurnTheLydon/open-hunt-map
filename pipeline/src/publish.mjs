// Validate and publish. Each layer uploads a versioned .pmtiles file and its own
// layers/<id>.json; manifest.json is then rebuilt from every layers/*.json. Separate files
// let CI build layers in parallel without overwriting each other's manifest entries.
import { storage } from './storage.mjs';

const layerKey = (id) => `layers/${id}.json`;

// A layer that shrinks sharply usually means a bad download, not lost land.
export async function validate(source, count, { force }) {
  const previous = (await storage.getJson(layerKey(source.id)))?.features;
  if (previous && count < previous * 0.9 && !force) {
    throw new Error(`${source.id}: ${count} features vs ${previous} last run (>10% drop). Re-run with --force if expected.`);
  }
}

export async function publish(source, tilesPath, info) {
  const now = new Date();
  const version = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const file = `${source.id}-${version}.pmtiles`;
  const previous = await storage.getJson(layerKey(source.id));

  await storage.putFile(file, tilesPath);
  await storage.putJson(layerKey(source.id), {
    id: source.id,
    kind: source.kind,
    state: source.state,
    name: source.name,
    file,
    previousFile: previous?.file ?? null,
    version,
    sourceDate: info.sourceDate ?? now.toISOString().slice(0, 10),
    features: info.features ?? null,
    bounds: info.bbox.map((v) => Math.round(v * 1e5) / 1e5),
    attribution: source.attribution,
    license: source.license,
    terms: source.terms,
    regulations: source.regulations ?? null,
  });

  // Keep the file the live manifest points at until the new manifest replaces it, so
  // open sessions don't break mid-pan; anything older goes.
  for (const key of await storage.list(`${source.id}-`)) {
    if (key.endsWith('.pmtiles') && key !== file && key !== previous?.file) await storage.delete(key);
  }
  return file;
}

export async function writeManifest() {
  const layers = {};
  for (const key of await storage.list('layers/')) {
    if (!key.endsWith('.json')) continue;
    const layer = await storage.getJson(key);
    layers[layer.id] = layer;
  }
  await storage.putJson('manifest.json', { generated: new Date().toISOString(), layers });
  return Object.keys(layers);
}
