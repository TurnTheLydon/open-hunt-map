// Load pipeline/sources/<state>/*.yaml. Each folder is a state (or "us" for national
// layers) with a state.yaml; every other file is one layer, whose id is <kind>-<state>.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { SOURCES_DIR } from './paths.mjs';

// Zoom ranges per layer kind; a source can override them with `tile:`.
const TILE_DEFAULTS = {
  parcels: { minzoom: 12, maxzoom: 15 },
  gamelands: { minzoom: 6, maxzoom: 14 },
  publicland: { minzoom: 5, maxzoom: 14 },
};

const readYaml = (path) => parse(readFileSync(path, 'utf8'));

export function loadStates() {
  return readdirSync(SOURCES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(SOURCES_DIR, d.name, 'state.yaml')))
    .map((d) => ({ code: d.name, ...readYaml(join(SOURCES_DIR, d.name, 'state.yaml')) }));
}

export function loadSources() {
  const sources = [];
  for (const state of loadStates()) {
    const dir = join(SOURCES_DIR, state.code);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.yaml') && f !== 'state.yaml')) {
      const source = readYaml(join(dir, file));
      sources.push({
        ...source,
        id: `${source.kind}-${state.code}`,
        state: state.code,
        enabled: state.enabled,
        tile: { layer: source.kind, ...TILE_DEFAULTS[source.kind], ...source.tile },
      });
    }
  }
  return sources;
}

// Bounding boxes of enabled states, which the basemap covers.
export function enabledRegions() {
  return loadStates()
    .filter((s) => s.enabled && !s.national && s.bbox)
    .map((s) => s.bbox);
}
