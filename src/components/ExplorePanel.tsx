import { useEffect, useMemo, useState } from 'react';
import { CATEGORY_META, glyphSvg } from '../map/icons';
import { mapRef } from '../map/mapRef';
import { formatAgo, formatDistance, haversine } from '../lib/geo';
import { loadServices, routeToService, selectService, serviceToPlace, setDestination } from '../state/actions';
import { setState, toast, useStore } from '../state/store';
import type { LatLon, Service, ServiceCategory } from '../types';
import { Icon } from './Icon';

const CATS: ServiceCategory[] = ['hospital', 'clinic', 'station', 'emergency'];

function Glyph({ cat }: { cat: ServiceCategory }) {
  return <span className="svc-glyph" style={{ '--c': CATEGORY_META[cat].color } as React.CSSProperties} dangerouslySetInnerHTML={{ __html: glyphSvg(cat, 16) }} />;
}

export function useReferencePoint(): { point: LatLon; label: string } | null {
  const origin = useStore((s) => s.origin);
  const fix = useStore((s) => s.geo.fix);
  const watching = useStore((s) => s.geo.watching);
  if (fix && watching) return { point: fix, label: 'your live location' };
  if (origin) return { point: origin, label: `start: ${origin.name}` };
  return null;
}

export function ServiceCard({ svc }: { svc: Service }) {
  const ref = useReferencePoint();
  const d = ref ? haversine(ref.point, svc) : null;
  return (
    <div className="svc-card" aria-live="polite">
      <div className="svc-card-head">
        <Glyph cat={svc.category} />
        <div className="svc-card-title">
          <strong>{svc.name}</strong>
          <span className="muted small">{svc.subtype}</span>
        </div>
        <button type="button" className="icon-btn sm" aria-label="Close details" onClick={() => selectService(null, false)}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <dl className="svc-meta">
        <dt>Address</dt>
        <dd>{svc.address ?? 'Not listed in OpenStreetMap'}</dd>
        <dt>Distance</dt>
        <dd>{d != null ? `${formatDistance(d)} straight-line from ${ref!.label}` : 'Set a start point or enable location to see distance'}</dd>
        <dt>Source</dt>
        <dd>
          <a href={svc.osmUrl} target="_blank" rel="noopener">
            OpenStreetMap record <Icon name="external" size={12} />
          </a>
          {!svc.named && ' · name not recorded in OSM'}
        </dd>
      </dl>
      <p className="small muted">Phone numbers, opening hours and capabilities are not shown because they are not verified. Call 112 in an emergency.</p>
      <div className="btn-row">
        <button type="button" className="btn btn-primary" onClick={() => routeToService(svc)}>
          <Icon name="nav" size={18} /> Route here
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setDestination(serviceToPlace(svc));
            selectService(null, false);
            setState({ tab: 'map', searchOpen: true });
          }}
        >
          Set as destination
        </button>
      </div>
    </div>
  );
}

export function ExplorePanel() {
  const services = useStore((s) => s.services);
  const filters = useStore((s) => s.filters);
  const selected = useStore((s) => s.selectedService);
  const ref = useReferencePoint();
  const [q, setQ] = useState('');
  const [center, setCenter] = useState<LatLon | null>(null);

  useEffect(() => {
    if (services.status === 'idle') void loadServices();
  }, [services.status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const upd = () => {
      const c = map.getCenter();
      setCenter({ lat: c.lat, lon: c.lng });
    };
    upd();
    map.on('moveend', upd);
    return () => {
      map.off('moveend', upd);
    };
  }, []);

  const refPt = ref?.point ?? center;
  const refLabel = ref?.label ?? 'map centre';
  const items = services.data?.items ?? [];
  const counts = useMemo(() => {
    const c: Record<ServiceCategory, number> = { hospital: 0, clinic: 0, station: 0, emergency: 0 };
    items.forEach((i) => c[i.category]++);
    return c;
  }, [items]);

  const nearby = useMemo(() => {
    if (!refPt) return [];
    const ql = q.trim().toLowerCase();
    return items
      .filter((i) => filters[i.category] && (!ql || i.name.toLowerCase().includes(ql) || i.subtype.toLowerCase().includes(ql)))
      .map((i) => ({ i, d: haversine(refPt, i) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 40);
  }, [items, filters, refPt, q]);

  const searchArea = () => {
    const map = mapRef.current;
    if (!map) return;
    if (map.getZoom() < 12) {
      toast('Zoom in a little to search this area.', 'warn');
      return;
    }
    const b = map.getBounds();
    void loadServices({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, true);
  };

  return (
    <div className="panel-pad">
      {selected && <ServiceCard svc={selected} />}
      <h2 className="panel-title">Essential services</h2>
      <div className="chips" role="group" aria-label="Service categories shown on map">
        {CATS.map((c) => (
          <button
            key={c}
            type="button"
            className={`chip cat ${filters[c] ? 'is-on' : ''}`}
            aria-pressed={filters[c]}
            style={{ '--c': CATEGORY_META[c].color } as React.CSSProperties}
            onClick={() => setState((s) => ({ filters: { ...s.filters, [c]: !s.filters[c] } }))}
          >
            <Glyph cat={c} /> {CATEGORY_META[c].plural}
            {services.status === 'ok' && <span className="chip-count">{counts[c]}</span>}
          </button>
        ))}
      </div>

      <div className="data-line small">
        {services.status === 'loading' && (
          <span className="loading-row slim">
            <span className="spinner" /> Loading from OpenStreetMap (Overpass)…
          </span>
        )}
        {services.status === 'ok' && services.data && (
          <span className="muted">
            {items.length.toLocaleString('en-IN')} places · {services.data.scope} · OSM via Overpass · {services.data.fromCache ? 'cached, fetched' : 'fetched'} {formatAgo(services.data.fetchedAt)}
          </span>
        )}
        {services.status === 'error' && (
          <span className="error-text" role="alert">
            <Icon name="warn" size={14} /> {services.error}
          </span>
        )}
        <span className="data-actions">
          <button type="button" className="link-btn" onClick={searchArea} disabled={services.status === 'loading'}>
            Search this map area
          </button>
          <button type="button" className="link-btn" onClick={() => loadServices('mumbai', true)} disabled={services.status === 'loading'}>
            <Icon name="refresh" size={14} /> Refresh
          </button>
        </span>
      </div>

      <label className="filter-input">
        <Icon name="search" size={16} />
        <input type="search" placeholder="Filter by name (e.g. KEM, Dadar)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter services by name" />
      </label>

      {services.status === 'ok' && !Object.values(filters).some(Boolean) && <p className="muted small">Turn on at least one category above.</p>}
      {services.status === 'ok' && Object.values(filters).some(Boolean) && nearby.length === 0 && <p className="muted small">No matching services nearby.</p>}

      {nearby.length > 0 && (
        <>
          <div className="sugg-head">Nearest to {refLabel} · straight-line</div>
          <ul className="svc-list">
            {nearby.map(({ i, d }) => (
              <li key={i.id}>
                <button type="button" className={`list-row ${selected?.id === i.id ? 'is-on' : ''}`} onClick={() => selectService(i)}>
                  <Glyph cat={i.category} />
                  <span className="sugg-text">
                    <span className="sugg-name">{i.name}</span>
                    <span className="sugg-ctx">
                      {i.subtype}
                      {i.address ? ` · ${i.address}` : ''}
                    </span>
                  </span>
                  <span className="dist">{formatDistance(d)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
