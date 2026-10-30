import type {
  ExpressionSpecification,
  LayerSpecification,
  SourceSpecification,
  StyleSpecification,
} from 'maplibre-gl';
import { layers as basemapLayers, namedFlavor } from '@protomaps/basemaps';
import { layersOfKind, tileUrl, type LayerInfo, type LayerKind, type Manifest } from './manifest';

// Overlay kinds the user can toggle, in draw order (bottom to top).
export const OVERLAYS = [
  { kind: 'publicland', label: 'Public land' },
  { kind: 'gamelands', label: 'Game lands' },
  { kind: 'parcels', label: 'Parcels' },
] as const;
export type OverlayKind = (typeof OVERLAYS)[number]['kind'];

// PAD-US Pub_Access codes.
export const ACCESS_LABELS: Record<string, string> = {
  OA: 'Open access',
  RA: 'Restricted access',
  XA: 'Closed',
  UK: 'Access unknown',
};

// Game land zones that change what you may do inside a game land.
const ZONE_TYPES = [
  'Safety Zone',
  'Restricted Zone',
  'Restricted Firearms Zone',
  'Restricted Deer Hunting Zone',
  'Wildlife Refuge',
  'Archery Zone',
  'Waterfowl Impoundment',
];

// Layers for one source. Ids are `<source id>-<role>`; `metadata.kind` drives toggles and taps.
// (Omit<> over MapLibre's layer union would drop per-type keys like `filter`.)
type LayerTemplate = { role: string; tap?: boolean; type: LayerSpecification['type']; [key: string]: unknown };

const PUBLICLAND: LayerTemplate[] = [
  {
    role: 'fill',
    tap: true,
    type: 'fill',
    paint: {
      'fill-color': ['match', ['get', 'access'], 'OA', '#4c9a5b', 'RA', '#d19a2a', 'XA', '#b5483b', '#8a8f86'],
      'fill-opacity': 0.22,
    },
  },
  {
    role: 'line',
    type: 'line',
    paint: {
      'line-color': ['match', ['get', 'access'], 'OA', '#2f7340', 'RA', '#a3741a', 'XA', '#8e3026', '#5f645c'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 1.5],
    },
  },
];

const isZone: ExpressionSpecification = ['in', ['get', 'type'], ['literal', ZONE_TYPES]];
const GAMELANDS: LayerTemplate[] = [
  { role: 'fill', tap: true, type: 'fill', filter: ['!', isZone], paint: { 'fill-color': '#e07b1a', 'fill-opacity': 0.25 } },
  {
    role: 'line',
    type: 'line',
    filter: ['!', isZone],
    paint: { 'line-color': '#b35c0c', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.75, 14, 2] },
  },
  { role: 'zone-fill', tap: true, type: 'fill', filter: isZone, paint: { 'fill-color': '#c62828', 'fill-opacity': 0.18 } },
  {
    role: 'zone-line',
    type: 'line',
    filter: isZone,
    paint: { 'line-color': '#c62828', 'line-width': 1.5, 'line-dasharray': [2, 1.5] },
  },
  {
    role: 'label',
    type: 'symbol',
    minzoom: 9,
    filter: ['!', isZone],
    // A game land is many tracts with the same name: let big tracts win and space labels out.
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Medium'],
      'text-size': 12,
      'text-padding': 60,
      'symbol-sort-key': ['-', 0, ['coalesce', ['get', 'acres'], 0]],
    },
    paint: { 'text-color': '#8a4508', 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
  },
];

const PARCELS: LayerTemplate[] = [
  {
    // Near-transparent fill so the whole parcel is tappable, not just its outline.
    role: 'fill',
    tap: true,
    type: 'fill',
    paint: {
      'fill-color': '#7b3fa0',
      'fill-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.3, 0.01],
    },
  },
  {
    role: 'line',
    type: 'line',
    paint: {
      'line-color': '#7b3fa0',
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.3, 16, 1.2],
      'line-opacity': 0.8,
    },
  },
  {
    role: 'label',
    type: 'symbol',
    minzoom: 15.5,
    layout: { 'text-field': ['get', 'owner'], 'text-font': ['Noto Sans Regular'], 'text-size': 10, 'text-max-width': 8 },
    paint: { 'text-color': '#4e2366', 'text-halo-color': '#fff', 'text-halo-width': 1.2 },
  },
];

const TEMPLATES: Record<OverlayKind, LayerTemplate[]> = { publicland: PUBLICLAND, gamelands: GAMELANDS, parcels: PARCELS };

function overlayLayers(layer: LayerInfo, kind: OverlayKind): LayerSpecification[] {
  return TEMPLATES[kind].map(({ role, tap, ...spec }) => ({
    ...spec,
    id: `${layer.id}-${role}`,
    source: layer.id,
    'source-layer': kind,
    metadata: { kind, tap: Boolean(tap) },
  })) as LayerSpecification[];
}

export function buildStyle(manifest: Manifest): StyleSpecification {
  const sources: Record<string, SourceSpecification> = {};
  for (const layer of Object.values(manifest.layers)) {
    sources[layer.id] = { type: 'vector', url: tileUrl(layer), attribution: layer.attribution };
  }

  const layers: LayerSpecification[] = [];
  const basemap = layersOfKind(manifest, 'basemap')[0];
  if (basemap) {
    layers.push(...basemapLayers(basemap.id, namedFlavor('light'), { lang: 'en' }));
  } else {
    layers.push({ id: 'background', type: 'background', paint: { 'background-color': '#e9e6df' } });
  }
  for (const { kind } of OVERLAYS) {
    for (const layer of layersOfKind(manifest, kind)) layers.push(...overlayLayers(layer, kind));
  }

  return {
    version: 8,
    glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
    sprite: 'https://protomaps.github.io/basemaps-assets/sprites/v4/light',
    sources,
    layers,
  };
}

const meta = (l: LayerSpecification) => (l.metadata ?? {}) as { kind?: LayerKind; tap?: boolean };

export function layerIdsOfKind(style: StyleSpecification, kind: OverlayKind): string[] {
  return style.layers.filter((l) => meta(l).kind === kind).map((l) => l.id);
}

export function tappableLayerIds(style: StyleSpecification): string[] {
  return style.layers.filter((l) => meta(l).tap).map((l) => l.id);
}
