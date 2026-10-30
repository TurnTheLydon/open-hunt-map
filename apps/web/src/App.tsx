import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { MapGeoJSONFeature } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre finds its worker next to its own module URL, which bundling breaks; point at it explicitly.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { coverage, layersOfKind, loadManifest, type Manifest } from './manifest';
import { buildStyle, layerIdsOfKind, OVERLAYS, tappableLayerIds, type OverlayKind } from './style';
import { InfoPanel } from './InfoPanel';
import { Disclaimer } from './Disclaimer';

maplibregl.setWorkerUrl(workerUrl);
maplibregl.addProtocol('pmtiles', new Protocol().tile);

export default function App() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState<Record<OverlayKind, boolean>>({ publicland: true, gamelands: true, parcels: true });
  const [selected, setSelected] = useState<MapGeoJSONFeature[]>([]);
  const [layersOpen, setLayersOpen] = useState(false);

  useEffect(() => {
    loadManifest().then(setManifest, (e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!manifest || !container.current) return;
    const style = buildStyle(manifest);
    const map = new maplibregl.Map({
      container: container.current,
      style,
      // A shared or reloaded URL (#zoom/lat/lng) wins; otherwise show everywhere we have parcels.
      ...(location.hash ? {} : { bounds: coverage(manifest) ?? [-84.33, 33.84, -75.46, 36.59] }),
      hash: true,
      attributionControl: false,
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(
      new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }),
      'top-right',
    );
    map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');
    // Always expanded: every active layer's source must stay visible (ODbL and the spec require it).
    map.addControl(new maplibregl.AttributionControl({ compact: false }), 'bottom-right');

    const tappable = tappableLayerIds(style);
    let highlighted: MapGeoJSONFeature | null = null;
    map.on('click', (e) => {
      const hits = map.queryRenderedFeatures(e.point, { layers: tappable });
      // One entry per feature, even when a feature has both a fill and a zone layer.
      const unique = hits.filter((f, i) => hits.findIndex((g) => g.source === f.source && g.id === f.id) === i);

      if (highlighted) map.setFeatureState(highlighted, { selected: false });
      highlighted = unique.find((f) => manifest.layers[f.source]?.kind === 'parcels' && f.id !== undefined) ?? null;
      if (highlighted) map.setFeatureState(highlighted, { selected: true });
      setSelected(unique);
    });
    for (const id of tappable) {
      map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''));
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [manifest]);

  const toggle = (kind: OverlayKind) => {
    const map = mapRef.current;
    const next = !visible[kind];
    setVisible({ ...visible, [kind]: next });
    if (!map) return;
    for (const layerId of layerIdsOfKind(map.getStyle(), kind)) {
      map.setLayoutProperty(layerId, 'visibility', next ? 'visible' : 'none');
    }
  };

  return (
    <>
      <div ref={container} className="map" />
      {error && <div className="banner">{error}</div>}

      {manifest && (
        <div className="layers">
          <button className="layers-toggle" onClick={() => setLayersOpen(!layersOpen)} aria-expanded={layersOpen}>
            Layers
          </button>
          {layersOpen && (
            <ul>
              {OVERLAYS.map(({ kind, label }) => {
                const sources = layersOfKind(manifest, kind);
                if (sources.length === 0) return null;
                return (
                  <li key={kind}>
                    <label>
                      <input type="checkbox" checked={visible[kind]} onChange={() => toggle(kind)} />
                      <span className={`swatch swatch-${kind}`} />
                      {label}
                    </label>
                    {sources.map((s) => (
                      <small key={s.id}>
                        {s.state === 'us' ? 'National' : s.state.toUpperCase()}: data as of {s.sourceDate}
                      </small>
                    ))}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {manifest && selected.length > 0 && (
        <InfoPanel features={selected} manifest={manifest} onClose={() => setSelected([])} />
      )}
      <Disclaimer />
    </>
  );
}
