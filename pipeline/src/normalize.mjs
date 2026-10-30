// Normalize: map each source's fields onto one schema per layer kind, so a second state's
// parcels look the same as NC's.

function compile(spec) {
  if (!spec.includes('{')) return (p) => p[spec];
  return (p) =>
    spec
      .replace(/\{(\w+)\}/g, (_, k) => (p[k] ?? '').toString().trim())
      .replace(/\s+/g, ' ')
      .replace(/(,\s*)+,/g, ',')
      .replace(/^[,\s]+|[,\s]+$/g, '');
}

function clean(value) {
  if (value === null || value === undefined) return undefined;
  // Counties fill blanks with placeholders like "-" or ", ,".
  if (typeof value === 'string') return /^[\s\-.,/]*$/.test(value) ? undefined : value.trim();
  if (typeof value === 'number') return Math.round(value * 100) / 100;
  return value;
}

// Returns a transform for fetched features, plus the running count and bounding box.
export function makeNormalizer(source) {
  const mappers = Object.entries(source.fields).map(([key, spec]) => [key, compile(spec)]);
  const stats = { count: 0, bbox: [Infinity, Infinity, -Infinity, -Infinity] };

  const transform = (f) => {
    const properties = {};
    for (const [key, map] of mappers) {
      let value = clean(map(f.properties));
      value = source.values?.[key]?.[value] ?? value;
      if (value !== undefined) properties[key] = value;
    }
    extend(stats.bbox, f.geometry.coordinates);
    stats.count++;
    return { type: 'Feature', id: f.id ?? f.properties[source.idField], properties, geometry: f.geometry };
  };

  return { transform, stats };
}

function extend(bbox, coords) {
  if (typeof coords[0] === 'number') {
    if (coords[0] < bbox[0]) bbox[0] = coords[0];
    if (coords[1] < bbox[1]) bbox[1] = coords[1];
    if (coords[0] > bbox[2]) bbox[2] = coords[0];
    if (coords[1] > bbox[3]) bbox[3] = coords[1];
    return;
  }
  for (const c of coords) extend(bbox, c);
}
