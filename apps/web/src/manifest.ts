// manifest.json is written by the pipeline's publish step and lists every layer the app can show.
export type LayerKind = 'basemap' | 'parcels' | 'gamelands' | 'publicland';

export interface LayerInfo {
  id: string;
  kind: LayerKind;
  state: string;
  name: string;
  file: string;
  version: string;
  sourceDate: string;
  features: number | null;
  bounds: [number, number, number, number];
  attribution: string;
  license: string;
  terms: string;
  regulations: string | null;
}

export interface Manifest {
  generated: string;
  layers: Record<string, LayerInfo>;
}

// Production: the bucket/CDN the pipeline publishes to (VITE_TILES_URL). Development: the
// web app's public/tiles folder, which `npm run data:sample` fills.
const configured = import.meta.env.VITE_TILES_URL as string | undefined;
export const TILES_BASE = configured ? configured.replace(/\/?$/, '/') : `${import.meta.env.BASE_URL}tiles/`;

export async function loadManifest(): Promise<Manifest> {
  const res = await fetch(`${TILES_BASE}manifest.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error('No map data found. Run `npm run data:sample` (development) or set VITE_TILES_URL.');
  return res.json();
}

export function tileUrl(layer: LayerInfo): string {
  return `pmtiles://${new URL(TILES_BASE + layer.file, location.href).href}`;
}

export function layersOfKind(manifest: Manifest, kind: LayerKind): LayerInfo[] {
  return Object.values(manifest.layers).filter((l) => l.kind === kind);
}

// Where the app opens: everywhere we have parcels.
export function coverage(manifest: Manifest): [number, number, number, number] | null {
  const parcels = layersOfKind(manifest, 'parcels');
  if (parcels.length === 0) return null;
  return parcels.reduce(
    (a, { bounds: [w, s, e, n] }) => [Math.min(a[0], w), Math.min(a[1], s), Math.max(a[2], e), Math.max(a[3], n)],
    [Infinity, Infinity, -Infinity, -Infinity] as [number, number, number, number],
  );
}
