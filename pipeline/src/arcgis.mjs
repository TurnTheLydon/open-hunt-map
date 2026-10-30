// Fetch: page through an ArcGIS REST layer as GeoJSON (the server reprojects to WGS84),
// one query per county with several counties in flight, and write one feature per line
// (GeoJSONSeq). Features pass through `transform` first, so only normalized data hits disk.
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';

async function getJson(url, params, tries = 5) {
  const qs = new URLSearchParams({ f: 'json', ...params });
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${url}?${qs}`, { signal: AbortSignal.timeout(180_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (body.error) throw new Error(`${body.error.code} ${body.error.message} ${body.error.details ?? ''}`);
      return body;
    } catch (err) {
      if (attempt >= tries) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

export async function layerInfo(url) {
  const info = await getJson(url, {});
  const edit = info.editingInfo?.dataLastEditDate ?? info.editingInfo?.lastEditDate;
  return {
    maxRecordCount: info.maxRecordCount ?? 1000,
    sourceDate: edit ? new Date(edit).toISOString().slice(0, 10) : null,
  };
}

function bboxParams(bbox) {
  if (!bbox) return {};
  return {
    geometry: bbox.join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
  };
}

async function countyList(source, base) {
  const res = await getJson(`${source.url}/query`, {
    ...base,
    outFields: source.countyField,
    returnDistinctValues: 'true',
    returnGeometry: 'false',
  });
  return res.features.map((f) => f.attributes[source.countyField]).filter(Boolean).sort();
}

// options: { counties?: string[], bbox?: number[] } from the command line override the source.
async function queries(source, options) {
  const base = { where: '1=1', ...bboxParams(options.bbox ?? source.bbox) };
  if (!source.counties) return [{ label: source.id, params: base }];

  const counties = options.counties ?? (source.counties === 'all' ? await countyList(source, base) : source.counties);
  return counties.map((county) => ({
    label: county,
    params: { ...base, where: `${source.countyField}='${String(county).replace(/'/g, "''")}'` },
  }));
}

export async function fetchArcgis(source, outPath, transform, options, log) {
  const { maxRecordCount } = await layerInfo(source.url);
  const jobs = await queries(source, options);
  log(`  ${jobs.length} ${source.counties ? 'counties' : 'queries'}`);

  const out = createWriteStream(outPath);
  let total = 0;
  let done = 0;

  const write = async (line) => {
    if (!out.write(line)) await once(out, 'drain');
  };

  const run = async ({ label, params }) => {
    const { count: expected } = await getJson(`${source.url}/query`, { ...params, returnCountOnly: 'true' });
    let got = 0;
    // Advance by what came back: some servers return less than maxRecordCount per page.
    for (let offset = 0; offset < expected; ) {
      const page = await getJson(`${source.url}/query`, {
        ...params,
        f: 'geojson',
        outFields: '*',
        outSR: '4326',
        geometryPrecision: '6',
        orderByFields: source.idField,
        resultOffset: String(offset),
        resultRecordCount: String(maxRecordCount),
      });
      if (page.features.length === 0) break;
      offset += page.features.length;
      for (const feature of page.features) {
        got++;
        if (!feature.geometry) continue;
        await write(JSON.stringify(transform(feature)) + '\n');
      }
    }
    if (got < expected) throw new Error(`${label}: fetched ${got} of ${expected} features`);
    total += got;
    log(`  ${label}: ${got} (${++done}/${jobs.length})`);
  };

  const queue = [...jobs];
  const workers = Array.from({ length: Math.min(source.concurrency ?? 4, queue.length) }, async () => {
    while (queue.length) await run(queue.shift());
  });
  await Promise.all(workers);

  out.end();
  await once(out, 'finish');
  return total;
}
