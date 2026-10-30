import type { MapGeoJSONFeature } from 'maplibre-gl';
import type { Manifest } from './manifest';
import { ACCESS_LABELS } from './style';
import { DISCLAIMER } from './Disclaimer';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const acres = (v: unknown) => (typeof v === 'number' ? `${v.toLocaleString('en-US')} ac` : undefined);
const money = (v: unknown) => (typeof v === 'number' ? usd.format(v) : undefined);

type Row = [label: string, value: unknown];

function Rows({ rows }: { rows: Row[] }) {
  return (
    <dl>
      {rows
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([label, v]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{String(v)}</dd>
          </div>
        ))}
    </dl>
  );
}

function Parcel({ p }: { p: Record<string, unknown> }) {
  return (
    <section>
      {/* Some states (Virginia) publish boundaries without owner names. */}
      <h2>{String(p.owner ?? `Parcel ${p.parcel_id ?? ''}`)}</h2>
      <p className="kind">Parcel</p>
      <Rows
        rows={[
          ['Second owner', p.owner2],
          ['Parcel ID', p.parcel_id],
          ['Acres', acres(p.acres)],
          ['Site address', p.site_address],
          ['Mailing address', p.mail_address],
          ['Assessed value', money(p.total_value)],
          ['Land value', money(p.land_value)],
          ['Land use', p.use],
          ['Last sale', p.sale_date],
          ['Legal description', p.legal],
          ['County', p.county],
        ]}
      />
      <p className="note">
        {DISCLAIMER} Parcel records come from the county; to correct one, contact the tax office for{' '}
        {String(p.county ?? 'that county')}.
      </p>
    </section>
  );
}

function GameLand({ p, regulations }: { p: Record<string, unknown>; regulations: string | null }) {
  const zone = p.type !== 'Game Land';
  return (
    <section>
      <h2>{String(p.name)}</h2>
      <p className={`kind ${zone ? 'warn' : ''}`}>{String(p.type)}</p>
      <Rows
        rows={[
          ['Tract', p.tract],
          ['Hunting days', p.days],
          ['Target shooting', p.target_shooting === 1 ? 'Allowed' : p.target_shooting === 0 ? 'Not allowed' : undefined],
          ['Managed by', p.owner],
          ['Acres', acres(p.acres)],
          ['County', p.county],
        ]}
      />
      {regulations && (
        <p className="note">
          Seasons, bag limits, and rules:{' '}
          <a href={regulations} target="_blank" rel="noreferrer">
            official regulations
          </a>
          .
        </p>
      )}
    </section>
  );
}

function PublicLand({ p }: { p: Record<string, unknown> }) {
  return (
    <section>
      <h2>{String(p.name ?? 'Public land')}</h2>
      <p className="kind">{ACCESS_LABELS[String(p.access)] ?? 'Public land'}</p>
      <Rows
        rows={[
          ['Designation', p.designation],
          ['Manager', p.manager],
          ['Manager type', p.manager_type],
          ['Acres', acres(p.acres)],
        ]}
      />
    </section>
  );
}

const ORDER = ['gamelands', 'publicland', 'parcels'];

export function InfoPanel({
  features,
  manifest,
  onClose,
}: {
  features: MapGeoJSONFeature[];
  manifest: Manifest;
  onClose: () => void;
}) {
  const kindOf = (f: MapGeoJSONFeature) => manifest.layers[f.source]?.kind;
  const sorted = [...features].sort((a, b) => ORDER.indexOf(kindOf(a)) - ORDER.indexOf(kindOf(b)));
  return (
    <aside className="info" aria-label="Details at this location">
      <button className="close" onClick={onClose} aria-label="Close">
        ×
      </button>
      {sorted.map((f) => {
        const layer = manifest.layers[f.source];
        return (
          <div key={`${f.source}:${f.id}`}>
            {layer?.kind === 'parcels' && <Parcel p={f.properties} />}
            {layer?.kind === 'gamelands' && <GameLand p={f.properties} regulations={layer.regulations} />}
            {layer?.kind === 'publicland' && <PublicLand p={f.properties} />}
            {layer && (
              <p className="source">
                Source: <a href={layer.terms} target="_blank" rel="noreferrer">{layer.attribution}</a>, data as of {layer.sourceDate}
              </p>
            )}
          </div>
        );
      })}
    </aside>
  );
}
