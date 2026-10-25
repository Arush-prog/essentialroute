import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { GPS, VECTOR_STYLES } from '../config';
import { mapRef } from '../map/mapRef';
import { formatTime } from '../lib/geo';
import { activeZones } from '../state/actions';
import { startLocation, stopLocation } from '../hooks/useGeolocation';
import { flyTo, setState, useStore, type Tab } from '../state/store';
import { Icon } from './Icon';
import { haptic } from '../lib/haptic';

export function Brand() {
  return (
    <div className="brand">
      <svg className="brand-mark" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="#20D9F3" />
        <path d="M9 22.5c3-6.5 6-3 8.5-8.5 1.2-2.7 3-4 5.5-4.5" stroke="#0B1220" strokeWidth="3" strokeLinecap="round" fill="none" />
        <circle cx="9" cy="22.5" r="2.6" fill="#0B1220" />
        <path d="M6 27c2 0 2-1 4-1s2 1 4 1 2-1 4-1 2 1 4 1 2-1 4-1" stroke="#0B1220" strokeWidth="1.6" strokeLinecap="round" fill="none" opacity=".55" />
      </svg>
      <span className="brand-word">
        Essential<b>Route</b>
      </span>
      <span className="city-chip" title="Geographic focus: Mumbai, Maharashtra">Mumbai</span>
    </div>
  );
}

export function StatusPill() {
  const simOn = useStore((s) => s.sim.enabled && s.sim.zones.length > 0);
  const reports = useStore((s) => (s.includeReports ? s.reports.length : 0));
  const n = useStore((s) => activeZones(s).length);
  const rainMode = useStore((s) => s.rain.mode);
  const rainZones = useStore((s) => s.rain.zones.length);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  let cls = 'ok';
  let text = 'Normal';
  if (!online) {
    cls = 'off';
    text = 'Offline';
  } else if (rainMode !== 'off' && rainMode !== 'live' && !simOn) {
    cls = 'sim';
    text = `Simulated rain · ${rainZones} spot${rainZones === 1 ? '' : 's'}`;
  } else if (rainMode === 'live' && rainZones && !simOn) {
    cls = 'rain';
    text = `Live rain · ${rainZones} risk spot${rainZones === 1 ? '' : 's'}`;
  } else if (simOn && reports) {
    cls = 'sim';
    text = `Simulation + reports · ${n}`;
  } else if (simOn) {
    cls = 'sim';
    text = `Simulation · ${n} zone${n > 1 ? 's' : ''}`;
  } else if (reports) {
    cls = 'rep';
    text = `User reports · ${reports}`;
  }
  return (
    <button type="button" className={`status-pill ${cls}`} onClick={() => setState({ tab: online && (simOn || reports) ? 'flood' : 'alerts' })} aria-label={`Status: ${text}. Open details`}>
      <span className="status-dot" aria-hidden="true" />
      {text}
    </button>
  );
}

/** Live GPS status: honest about what the browser is (or is not) delivering. */
export function GeoStatusChip() {
  const geo = useStore((s) => s.geo);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!geo.watching) return;
    const t = setInterval(() => tick((x) => x + 1), 5000);
    return () => clearInterval(t);
  }, [geo.watching]);
  const [help, setHelp] = useState(false);

  if (geo.status === 'idle' && !geo.watching) return null;
  const f = geo.fix;
  let tone = 'ok';
  let text = '';
  switch (geo.status) {
    case 'requesting':
      tone = 'pending';
      text = 'Updating location… allow access if asked';
      break;
    case 'active':
      text = f ? `Live location active · ±${Math.round(f.accuracy)} m · ${formatTime(f.timestamp)}` : 'Live location active';
      if (f && f.accuracy > GPS.poorAccuracyM) {
        tone = 'warn';
        text = `Low accuracy · ±${Math.round(f.accuracy)} m · ${formatTime(f.timestamp)}`;
      }
      break;
    case 'stale':
      tone = 'warn';
      text = f ? `No new fix since ${formatTime(f.timestamp)} — position may be outdated` : 'Waiting for location…';
      break;
    case 'timeout':
      tone = 'warn';
      text = 'Location timed out — still trying';
      break;
    case 'unavailable':
      tone = 'warn';
      text = 'Location unavailable — turn on device Location / GPS';
      break;
    case 'denied':
      tone = 'bad';
      text = 'Location permission denied';
      break;
    case 'insecure':
      tone = 'bad';
      text = 'Location needs HTTPS';
      break;
    case 'unsupported':
      tone = 'bad';
      text = 'Location not supported in this browser';
      break;
  }
  const failing = ['denied', 'insecure', 'unsupported', 'unavailable', 'timeout'].includes(geo.status);
  return (
    <div className={`geo-chip ${tone}`} role="status" aria-live="polite">
      <span className="geo-chip-dot" aria-hidden="true" />
      <span className="geo-chip-text">{text}</span>
      {failing && (
        <button type="button" className="link-btn" onClick={() => setHelp(true)}>
          Help
        </button>
      )}
      {geo.watching && (
        <button type="button" className="icon-btn xs" aria-label="Stop live location" onClick={stopLocation}>
          <Icon name="close" size={14} />
        </button>
      )}
      {!geo.watching && geo.status !== 'idle' && (
        <button type="button" className="icon-btn xs" aria-label="Dismiss" onClick={() => setState((s) => ({ geo: { ...s.geo, status: 'idle' } }))}>
          <Icon name="close" size={14} />
        </button>
      )}
      {help && <LocationHelp onClose={() => setHelp(false)} />}
    </div>
  );
}

export function LocationHelp({ onClose }: { onClose: () => void }) {
  const status = useStore((s) => s.geo.status);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="loc-help-h" tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <h2 id="loc-help-h">Using your location</h2>
        {status === 'insecure' && <p>Browsers only share GPS with secure pages. Open EssentialRoute over <strong>https://</strong> (or on <strong>localhost</strong> on this computer).</p>}
        {status === 'denied' && (
          <>
            <p>Location access is blocked for this site.</p>
            <ul>
              <li><strong>Android Chrome:</strong> tap the icon left of the address → Permissions → Location → Allow. Also check Settings → Apps → Chrome → Permissions → Location.</li>
              <li><strong>Samsung Internet:</strong> menu → Settings → Sites and downloads → Site permissions → Location.</li>
              <li><strong>Installed app (home screen):</strong> long-press the EssentialRoute icon → App info → Permissions → Location.</li>
              <li><strong>iPhone Safari:</strong> Settings → Privacy &amp; Security → Location Services → Safari Websites → While Using; then reload. Also check “aA” → Website Settings → Location.</li>
              <li><strong>Windows (Chrome/Edge):</strong> click the lock icon → Site settings → Location → Allow, and enable Windows Settings → Privacy → Location.</li>
            </ul>
          </>
        )}
        {(status === 'unavailable' || status === 'timeout') && (
          <>
            <p>Your device could not get a position.</p>
            <ul>
              <li><strong>Android:</strong> swipe down from the top and turn on <em>Location</em>. In Settings → Location, enable <em>Google Location Accuracy</em> (or “Improve accuracy”) for a faster fix.</li>
              <li>Check Settings → Apps → Chrome (or Samsung Internet) → Permissions → Location is allowed.</li>
              <li>Move near a window or outdoors — GPS struggles indoors.</li>
            </ul>
          </>
        )}
        <p>
          <strong>No GPS? No problem.</strong> Type a starting point in the search box, pick a suggested place, or long-press the map and choose <em>Start from here</em>.
        </p>
        <p className="small muted">Live tracking may pause when the app is in the background or the phone restricts location. Your position is never stored or sent anywhere except to the routing and address services when you request a route.</p>
        <div className="btn-row">
          <button type="button" className="btn btn-primary" onClick={onClose}>OK</button>
          {status !== 'insecure' && status !== 'unsupported' && (
            <button type="button" className="btn btn-ghost" onClick={() => { onClose(); startLocation(); }}>Try again</button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function MapControls() {
  const geo = useStore((s) => s.geo);
  const follow = useStore((s) => s.follow);
  const base = useStore((s) => s.baseLayer);
  const onLocate = () => {
    haptic(10);
    if (geo.watching && geo.fix) {
      setState({ follow: true });
      flyTo(geo.fix.lat, geo.fix.lon, 16);
      return;
    }
    const ok = startLocation();
    if (ok) setState({ follow: true });
  };
  return (
    <div className="map-controls" aria-label="Map controls">
      <button type="button" className="ctl zoom" aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>
        <Icon name="plus" />
      </button>
      <button type="button" className="ctl zoom" aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>
        <Icon name="minus" />
      </button>
      <button type="button" className="ctl" aria-label={`Map style: ${VECTOR_STYLES[base].label}. Switch to ${VECTOR_STYLES[base === 'standard' ? 'clean' : 'standard'].label}`} title="Map style" onClick={() => setState({ baseLayer: base === 'standard' ? 'clean' : 'standard' })}>
        <Icon name="layers" />
      </button>
      <button
        type="button"
        className={`ctl locate ${follow && geo.watching ? 'is-on' : ''} ${geo.status === 'requesting' ? 'is-busy' : ''}`}
        aria-label={geo.watching && geo.fix ? 'Recenter on me' : 'Show my live location'}
        title={geo.watching && geo.fix ? 'Recenter on me' : 'Show my live location'}
        onClick={onLocate}
      >
        <Icon name={follow && geo.watching ? 'nav' : 'locate'} />
      </button>
    </div>
  );
}

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'map', label: 'Map', icon: 'map' },
  { id: 'explore', label: 'Explore', icon: 'compass' },
  { id: 'flood', label: 'Flood Analysis', icon: 'flood' },
  { id: 'ask', label: 'Ask AI', icon: 'spark' },
  { id: 'alerts', label: 'Alerts', icon: 'bell' },
];

export function TabBar({ variant }: { variant: 'bottom' | 'side' }) {
  const tab = useStore((s) => s.tab);
  const reportCount = useStore((s) => s.reports.length);
  return (
    <nav className={variant === 'bottom' ? 'bottom-nav' : 'side-tabs'} aria-label="Main">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={tab === t.id ? 'is-on' : ''}
          aria-current={tab === t.id ? 'page' : undefined}
          onClick={() => {
            haptic(8);
            setState((s) => ({ tab: t.id, searchOpen: false, sheetSnap: t.id === 'map' && !s.destination ? 'peek' : 'half', sidebarOpen: true }));
          }}
        >
          <span className="nav-ic">
            <Icon name={t.icon} size={22} />
            {t.id === 'alerts' && reportCount > 0 && <span className="nav-badge">{reportCount}</span>}
          </span>
          <span className="nav-label">{t.id === 'flood' && variant === 'bottom' ? 'Flood' : t.label}</span>
        </button>
      ))}
    </nav>
  );
}

type Snap = 'peek' | 'half' | 'full';

/** Draggable bottom sheet with three snap points. */
export function BottomSheet({ children, snap, onSnap, label, resetKey }: { children: ReactNode; snap: Snap; onSnap: (s: Snap) => void; label: string; resetKey?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 }); // a new tab always starts at its top, not at the previous tab's scroll offset
  }, [resetKey]);
  const drag = useRef<{ y0: number; h0: number; moved: boolean } | null>(null);
  const [dragH, setDragH] = useState<number | null>(null);
  const [, setVh] = useState(() => window.innerHeight);
  useEffect(() => {
    // Android: URL bar show/hide, keyboard and rotation all change the viewport height
    const on = () => setVh(window.innerHeight);
    window.addEventListener('resize', on);
    window.visualViewport?.addEventListener('resize', on);
    return () => {
      window.removeEventListener('resize', on);
      window.visualViewport?.removeEventListener('resize', on);
    };
  }, []);

  const heightFor = (s: Snap) => {
    const vh = window.innerHeight;
    // small Android phones in landscape can be <420px tall — keep every snap usable
    const full = Math.max(200, vh - 150);
    return s === 'peek' ? Math.min(132, Math.round(vh * 0.3)) : s === 'half' ? Math.min(full, Math.max(220, Math.round(vh * (vh < 700 ? 0.41 : 0.46)))) : full;
  };

  const onDown = (e: React.PointerEvent) => {
    drag.current = { y0: e.clientY, h0: ref.current?.offsetHeight ?? heightFor(snap), moved: false };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dy = d.y0 - e.clientY;
    if (Math.abs(dy) > 4) d.moved = true;
    setDragH(Math.max(90, Math.min(window.innerHeight - 110, d.h0 + dy)));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      onSnap(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'half');
      setDragH(null);
      return;
    }
    const h = dragH ?? d.h0;
    const opts: Snap[] = ['peek', 'half', 'full'];
    const best = opts.reduce((a, b) => (Math.abs(heightFor(b) - h) < Math.abs(heightFor(a) - h) ? b : a));
    onSnap(best);
    setDragH(null);
  };

  return (
    <section className={`sheet snap-${snap} ${dragH != null ? 'is-dragging' : ''}`} ref={ref} style={dragH != null ? { height: dragH } : { height: heightFor(snap) }} aria-label={label}>
      <div
        className="sheet-handle"
        role="button"
        tabIndex={0}
        aria-label={`Resize panel (currently ${snap})`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') onSnap(snap === 'peek' ? 'half' : 'full');
          if (e.key === 'ArrowDown') onSnap(snap === 'full' ? 'half' : 'peek');
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSnap(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'half');
          }
        }}
      >
        <span />
      </div>
      <div className="sheet-body" ref={bodyRef}>{children}</div>
    </section>
  );
}

export function Toast() {
  const t = useStore((s) => s.toast);
  if (!t) return null;
  return (
    <div className={`toast ${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'} key={t.id}>
      {t.text}
    </div>
  );
}

export function Banners() {
  const tiles = useStore((s) => s.tiles);
  const placing = useStore((s) => s.sim.placing);
  const reportPlacing = useStore((s) => s.reportPlacing);
  return (
    <div className="banners">
      {tiles === 'loading' && (
        <div className="banner subtle" role="status">
          <span className="spinner" /> Loading map…
        </div>
      )}
      {tiles === 'error' && (
        <div className="banner error" role="alert">
          <Icon name="warn" size={16} /> Map tiles could not load. Check your connection — the map will retry as you move it.
        </div>
      )}
      {placing && (
        <div className="banner sim" role="status">
          <Icon name="target" size={16} /> Tap the map to add a <b>simulated</b> flood zone
          <button type="button" className="link-btn" onClick={() => setState((s) => ({ sim: { ...s.sim, placing: false } }))}>
            Done
          </button>
        </div>
      )}
      {reportPlacing && (
        <div className="banner rep" role="status">
          <Icon name="target" size={16} /> Tap the map where you see waterlogging
          <button type="button" className="link-btn" onClick={() => setState({ reportPlacing: false })}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
