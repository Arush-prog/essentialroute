import { useState } from 'react';
import { SEVERITY, SEVERITY_ORDER } from '../analysis/flood';
import { CATEGORY_META } from '../map/icons';
import { SEVERITY_COLOR } from '../map/MapView';
import { formatDistance, formatTime } from '../lib/geo';
import { activeZones, loadPresetScenario, refreshLiveRain, removeSimZone, resetSimulation, runAnalysis, setRadar, setRainMode, setSeverity, updateSimZoneRadius } from '../state/actions';
import { HOTSPOTS, RAIN_LEVELS, type RainMode } from '../analysis/rain';
import { rainLabel } from '../services/weather';
import { setState, useStore } from '../state/store';
import type { ServiceCategory } from '../types';
import { Icon } from './Icon';
import { RouteSafetyCard } from './RoutePanel';

export function FloodPanel() {
  const sim = useStore((s) => s.sim);
  const reports = useStore((s) => s.reports);
  const includeReports = useStore((s) => s.includeReports);
  const analysis = useStore((s) => s.analysis);
  const graph = useStore((s) => s.graph);
  const category = useStore((s) => s.analysisCategory);
  const zones = useStore((s) => activeZones(s));
  const [showMethod, setShowMethod] = useState(false);

  const [customOpen, setCustomOpen] = useState(sim.zones.length > 0);
  const [accOpen, setAccOpen] = useState(analysis.status !== 'idle');

  return (
    <div className="panel-pad">
      <section className="card-sec" aria-labelledby="rt-h">
        <h2 id="rt-h" className="panel-title">Your route</h2>
        <RouteSafetyCard />
      </section>

      <RainSection />

      <section className="card-sec">
        <details className="adv" open={customOpen} onToggle={(e) => setCustomOpen((e.target as HTMLDetailsElement).open)}>
          <summary>
            <Icon name="flood" size={18} /> <span>Flood zones</span>
            <span className="adv-meta">{sim.enabled && sim.zones.length ? `${sim.zones.length} simulated · ${SEVERITY[sim.severity].label}` : 'Place your own'}</span>
          </summary>
          <div className="sec-head">
            <span className="small muted">Simulation on</span>
            <label className="switch">
              <input type="checkbox" checked={sim.enabled} onChange={(e) => setState((s) => ({ sim: { ...s.sim, enabled: e.target.checked } }))} />
              <span className="switch-track" aria-hidden="true" />
              <span className="sr-only">Enable flood simulation</span>
            </label>
          </div>

          <div className="field-label" id="sev-label">Severity</div>
          <div className="seg sev" role="radiogroup" aria-labelledby="sev-label">
            {SEVERITY_ORDER.map((sv) => (
              <button key={sv} type="button" role="radio" aria-checked={sim.severity === sv} className={sim.severity === sv ? 'is-on' : ''} style={{ '--c': SEVERITY_COLOR[sv] } as React.CSSProperties} onClick={() => setSeverity(sv)}>
                {SEVERITY[sv].label}
              </button>
            ))}
          </div>
          <p className="small muted">{SEVERITY[sim.severity].hint}</p>

          <div className="btn-row wrap">
            <button
              type="button"
              className={`btn ${sim.placing ? 'btn-primary' : 'btn-ghost'}`}
              aria-pressed={sim.placing}
              onClick={() => setState((s) => ({ sim: { ...s.sim, placing: !s.sim.placing, enabled: true }, reportPlacing: false, sheetSnap: !s.sim.placing ? 'peek' : s.sheetSnap }))}
            >
              <Icon name="target" size={18} /> {sim.placing ? 'Tap map to place… (done)' : 'Place zones on map'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={loadPresetScenario}>
              <Icon name="play" size={16} /> Known hotspots
            </button>
          </div>
          <label className="range">
            <span>New zone radius: {formatDistance(sim.radiusM)}</span>
            <input type="range" min={150} max={1500} step={50} value={sim.radiusM} onChange={(e) => setState((s) => ({ sim: { ...s.sim, radiusM: Number(e.target.value) } }))} />
          </label>

          {sim.zones.length > 0 ? (
            <ul className="zone-list">
              {sim.zones.map((z) => (
                <li key={z.id}>
                  <span className="zone-swatch" style={{ background: SEVERITY_COLOR[sim.severity] }} />
                  <div className="zone-main">
                    <strong>{z.label}</strong>
                    <span className="tag sim">SIMULATED</span>
                    <input type="range" aria-label={`Radius for ${z.label}`} min={150} max={1500} step={50} value={z.radiusM} onChange={(e) => updateSimZoneRadius(z.id, Number(e.target.value))} />
                    <span className="small muted">
                      {formatDistance(z.radiusM)} radius{sim.severity === 'extreme' ? ` (effective ${formatDistance(z.radiusM * 1.35)})` : ''}
                    </span>
                  </div>
                  <button type="button" className="icon-btn sm" aria-label={`Remove ${z.label}`} onClick={() => removeSimZone(z.id)}>
                    <Icon name="trash" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">No flood zones yet. Tap “Place zones on map”, or load the known waterlogging hotspots.</p>
          )}

          <label className="check-row">
            <input type="checkbox" checked={includeReports} onChange={(e) => setState({ includeReports: e.target.checked })} />
            <span>
              Include user reports in routing ({reports.length}) <span className="tag rep">UNVERIFIED</span>
            </span>
          </label>

          <div className="btn-row">
            <button type="button" className="btn btn-ghost danger" onClick={resetSimulation} disabled={!sim.zones.length && !sim.enabled}>
              <Icon name="refresh" size={16} /> Reset flood zones
            </button>
          </div>
          <Legend />
        </details>
      </section>

      <section className="card-sec">
        <details className="adv" open={accOpen} onToggle={(e) => setAccOpen((e.target as HTMLDetailsElement).open)}>
        <summary>
          <Icon name="compass" size={18} /> <span id="acc-h">Hospital &amp; station access</span>
          <span className="adv-meta">Who gets cut off?</span>
        </summary>
        <p className="small muted">Finds sample zones whose road access to the chosen service gets worse — or disappears — under the current scenario.</p>
        <div className="field-label">Service</div>
        <div className="seg" role="radiogroup" aria-label="Service category for analysis">
          {(['hospital', 'station', 'clinic', 'emergency'] as ServiceCategory[]).map((c) => (
            <button key={c} type="button" role="radio" aria-checked={category === c} className={category === c ? 'is-on' : ''} onClick={() => setState({ analysisCategory: c, analysis: { status: 'idle' } })}>
              {CATEGORY_META[c].plural}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-primary full" onClick={runAnalysis} disabled={analysis.status === 'loading'}>
          {analysis.status === 'loading' ? <span className="spinner" /> : <Icon name="play" size={16} />}
          {analysis.status === 'loading' ? analysis.progress : zones.length ? `Analyse with ${zones.length} active zone${zones.length > 1 ? 's' : ''}` : 'Analyse baseline (no flooding)'}
        </button>
        {graph.status === 'ok' && graph.data && (
          <p className="small muted">
            Road graph: {graph.data.nodes.toLocaleString('en-IN')} nodes · {graph.data.edges.toLocaleString('en-IN')} segments · OSM major roads, built {formatTime(graph.data.builtAt)}
          </p>
        )}
        {graph.status === 'error' && <p className="error-text small">Road network: {graph.error}</p>}
        {analysis.status === 'error' && (
          <div className="callout error" role="alert">
            <Icon name="warn" size={18} />
            <div>
              <strong>Analysis unavailable</strong>
              <p className="small">{analysis.error} No figures are shown rather than estimates.</p>
            </div>
          </div>
        )}
        {analysis.status === 'ok' && analysis.data && <AnalysisResults />}

        <button type="button" className="disclosure" aria-expanded={showMethod} onClick={() => setShowMethod((v) => !v)}>
          <Icon name="chevron" size={16} className={showMethod ? 'rot90' : ''} /> Method &amp; limitations
        </button>
        {showMethod && (
          <div className="method small">
            <p><strong>Flood zones.</strong> Circles. A road segment is affected when it geometrically intersects a circle (exact segment–circle clipping). Severity: Low ×1.5 and Moderate ×3 travel-time penalty inside zones; High and Extreme make roads impassable; Extreme also widens zones by 35%.</p>
            <p><strong>Routing.</strong> OSRM routes and alternatives are scored against active zones. If none is clean, the app re-routes through detour waypoints on a ring outside the flooded area (up to 7 engine requests), and can fall back to A* on the OSM major-road graph.</p>
            <p><strong>Accessibility.</strong> The Mumbai major-road network (motorway → tertiary) is downloaded from OpenStreetMap and turned into a graph using shared node IDs. Multi-source Dijkstra from every service of the chosen type gives road distance to the nearest one, before and after flooding. Each sample zone (1.2 km circle around an approximate neighbourhood centre) is judged on all its road nodes: <em>reduced</em> if median distance rises ≥30% and ≥500 m, or ≥25% of nodes lose access; <em>no calculated route</em> if none can reach any service.</p>
            <p><strong>Limitations.</strong> Residential streets, one-way rules and turn restrictions are not modelled in the graph; distances are road lengths, not travel times; sample zones are not administrative wards and carry no population data. A “no calculated route” result means no path exists on the modelled major-road network — smaller lanes may still connect.</p>
          </div>
        )}
        </details>
      </section>

      <p className="small muted disclaimer">
        <Icon name="warn" size={14} /> Planning aid only. Flood zones are simulated or estimated; no live flood sensors or official road closures are connected. In an emergency call <strong>112</strong>.
      </p>
    </div>
  );
}

const RAIN_MODES: { id: RainMode; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'live', label: 'Live' },
  { id: 'moderate', label: 'Moderate' },
  { id: 'heavy', label: 'Heavy' },
  { id: 'extreme', label: 'Extreme' },
];

function RainSection() {
  const rain = useStore((s) => s.rain);
  const live = rain.live.data;
  const city = live?.readings[live.readings.length - 1];
  const spots = live ? live.readings.slice(0, HOTSPOTS.length).map((r, i) => ({ ...r, label: HOTSPOTS[i].label })) : [];
  const heaviest = spots.reduce<(typeof spots)[number] | null>((m, r) => (!m || r.nowMmH > m.nowMmH ? r : m), null);
  const hint =
    rain.mode === 'off'
      ? 'Rain is ignored when planning routes.'
      : rain.mode === 'live'
        ? `Uses live rainfall at ${HOTSPOTS.length} known waterlogging spots. Risk is an estimate from rainfall, not observed flooding.`
        : `${RAIN_LEVELS[rain.mode].hint} Simulated — not current conditions.`;
  return (
    <section className="card-sec" aria-labelledby="rain-h">
      <div className="sec-head">
        <h2 id="rain-h" className="panel-title">
          <Icon name="rain" size={20} /> Rain
        </h2>
        <button type="button" className="icon-btn sm" aria-label="Refresh live rainfall" disabled={rain.live.status === 'loading'} onClick={() => void refreshLiveRain(true)}>
          {rain.live.status === 'loading' ? <span className="spinner" /> : <Icon name="refresh" size={16} />}
        </button>
      </div>

      <div className="rain-now" aria-live="polite">
        {city ? (
          <>
            <div className="rain-big">
              <span className="tag live">LIVE</span> {rainLabel(city.nowMmH)} · <strong>{city.nowMmH} mm/h</strong>
            </div>
            <div className="small">
              Last 3 h: {city.last3hMm} mm · next hour: {city.nextMmH} mm
              {heaviest && heaviest.nowMmH > city.nowMmH ? ` · heaviest at ${heaviest.label} (${heaviest.nowMmH} mm/h)` : ''}
            </div>
            <div className="small muted">Open-Meteo weather model (~10 km grid), hour ending {formatTime(live!.validAt).slice(0, 5)} · updated {formatTime(live!.fetchedAt).slice(0, 5)}</div>
          </>
        ) : rain.live.status === 'error' ? (
          <div className="small error-text">
            Live rainfall unavailable: {rain.live.error}{' '}
            <button type="button" className="link-btn" onClick={() => void refreshLiveRain(true)}>
              Retry
            </button>
          </div>
        ) : (
          <div className="small muted">
            <span className="spinner" /> Checking live rainfall in Mumbai…
          </div>
        )}
      </div>

      <div className="field-label" id="rain-mode-label">Plan routes for</div>
      <div className="seg rain-seg" role="radiogroup" aria-labelledby="rain-mode-label">
        {RAIN_MODES.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={rain.mode === m.id} className={rain.mode === m.id ? 'is-on' : ''} onClick={() => setRainMode(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <p className="small muted">{hint}</p>

      {rain.mode !== 'off' &&
        (rain.zones.length ? (
          <ul className="rain-spots">
            {rain.zones.map((z) => (
              <li key={z.id}>
                <span className="zone-swatch" style={{ background: SEVERITY_COLOR[z.severity ?? 'low'] }} />
                <span className="rs-name">{z.label}</span>
                <span className={`tag ${SEVERITY[z.severity ?? 'low'].blocked ? 'bad' : 'warn'}`}>{SEVERITY[z.severity ?? 'low'].blocked ? 'Avoid' : 'Slow'}</span>
              </li>
            ))}
          </ul>
        ) : (
          rain.mode === 'live' &&
          live && (
            <div className="callout ok">
              <Icon name="check" size={18} />
              <span>No waterlogging risk at current rainfall — routes are planned normally.</span>
            </div>
          )
        ))}

      <label className="check-row">
        <input type="checkbox" checked={rain.radar} onChange={(e) => void setRadar(e.target.checked)} />
        <span>
          Show live rain radar <span className="small muted">· RainViewer (coverage over India may be patchy)</span>
        </span>
      </label>
    </section>
  );
}

function Legend() {
  return (
    <div className="legend" aria-label="Map legend">
      <div className="legend-title">Legend</div>
      <div className="legend-grid">
        <span><i className="lg-line" style={{ background: '#1a73e8' }} /> Selected route</span>
        <span><i className="lg-line" style={{ background: '#7fa7e8' }} /> Alternative route</span>
        <span><i className="lg-line" style={{ background: '#FF3B3B' }} /> Impassable (simulated)</span>
        <span><i className="lg-line" style={{ background: '#FF8A1F' }} /> Flood-affected, passable</span>
        <span><i className="lg-line dashed" style={{ color: '#F59E0B' }} /> User-reported (unverified)</span>
        <span><i className="lg-line dotted" style={{ color: '#A3E635' }} /> Graph path (A*)</span>
        <span><i className="lg-zone" style={{ borderColor: '#FF3B3B', background: 'rgba(255,59,59,.25)' }} /> Simulated zone</span>
        <span><i className="lg-zone dashed" style={{ borderColor: '#F59E0B', background: 'rgba(245,158,11,.2)' }} /> Reported zone</span>
        <span><i className="lg-zone dashed" style={{ borderColor: '#FF8A1F', background: 'rgba(255,138,31,.2)' }} /> Rain-risk spot (estimate)</span>
      </div>
    </div>
  );
}

function AnalysisResults() {
  const a = useStore((s) => s.analysis.data)!;
  const [showOk, setShowOk] = useState(false);
  const flagged = a.zones.filter((z) => z.status === 'no-route' || z.status === 'reduced').sort((x, y) => (x.status === y.status ? 0 : x.status === 'no-route' ? -1 : 1));
  const rest = a.zones.filter((z) => z.status === 'ok' || z.status === 'no-data');
  const label = CATEGORY_META[a.category].plural.toLowerCase();
  return (
    <div className="analysis">
      <div className="stats">
        <div className="stat">
          <span className="stat-n">{a.affectedWays.toLocaleString('en-IN')}</span>
          <span className="stat-l">road segments affected <em>({a.affectedEdges} graph edges, {a.blockedEdges} impassable)</em></span>
        </div>
        <div className="stat">
          <span className="stat-n">{a.servicesHarder.length}</span>
          <span className="stat-l">{label} harder to reach <em>(inside a zone or cut off)</em></span>
        </div>
        <div className="stat warn">
          <span className="stat-n">{a.reducedCount}</span>
          <span className="stat-l">zones with reduced connectivity</span>
        </div>
        <div className="stat bad">
          <span className="stat-n">{a.noRouteCount}</span>
          <span className="stat-l">zones with no calculated route</span>
        </div>
      </div>
      <p className="small muted">
        Computed {formatTime(a.computedAt)} in {a.ms} ms over {a.graphNodes.toLocaleString('en-IN')} road nodes · {a.servicesSnapped} of {a.servicesTotal} {label} connected to the network · {a.zones.length} sample zones (approximate, not ward boundaries).
      </p>
      {a.floodedWayNames.length > 0 && <p className="small">Affected roads include: {a.floodedWayNames.join(', ')}.</p>}
      {flagged.length === 0 ? (
        <div className="callout ok">
          <Icon name="check" size={18} />
          <span>No sample zone loses meaningful access to {label} under this scenario.</span>
        </div>
      ) : (
        <ul className="zone-results">
          {flagged.map((z) => (
            <li key={z.zone.id} className={z.status}>
              <div className="zr-head">
                <strong>{z.zone.name}</strong>
                <span className={`tag ${z.status === 'no-route' ? 'bad' : 'warn'}`}>{z.status === 'no-route' ? 'No calculated route' : 'Reduced access'}</span>
              </div>
              <p className="small">{z.explanation}</p>
            </li>
          ))}
        </ul>
      )}
      {a.servicesHarder.length > 0 && (
        <p className="small muted">
          Harder to reach: {a.servicesHarder.slice(0, 6).map((s) => s.name).join(', ')}
          {a.servicesHarder.length > 6 ? ` and ${a.servicesHarder.length - 6} more` : ''}.
        </p>
      )}
      <button type="button" className="disclosure" aria-expanded={showOk} onClick={() => setShowOk((v) => !v)}>
        <Icon name="chevron" size={16} className={showOk ? 'rot90' : ''} /> Other zones ({rest.length})
      </button>
      {showOk && (
        <ul className="zone-results compact">
          {rest.map((z) => (
            <li key={z.zone.id}>
              <strong>{z.zone.name}</strong> <span className="small muted">{z.explanation}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
