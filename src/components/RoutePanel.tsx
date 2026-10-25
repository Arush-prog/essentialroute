import { useState } from 'react';
import { formatDistance, formatDuration, formatTime, haversine } from '../lib/geo';
import { activeZones, computeRoute, ensureGraph, setDestination, useMyLocation } from '../state/actions';
import { setState, useStore } from '../state/store';
import type { EvaluatedRoute, RoutePlan } from '../types';
import { Icon } from './Icon';
import { haptic } from '../lib/haptic';
import { POPULAR_PLACES } from '../data/places';
import { startDemoDrive, startNavigation, startPreview } from '../state/navigation';
import { InstallButton } from './InstallButton';

function ExposureBadge({ r }: { r: EvaluatedRoute }) {
  if (r.exposure.exposedM === 0) return <span className="badge ok"><Icon name="check" size={13} /> No flood exposure</span>;
  if (r.exposure.blocked) return <span className="badge bad"><Icon name="warn" size={13} /> Crosses impassable zone · {formatDistance(r.exposure.blockedM)}</span>;
  return <span className="badge warn"><Icon name="flood" size={13} /> {formatDistance(r.exposure.exposedM)} through flood zone</span>;
}

function routeLabel(plan: RoutePlan, r: EvaluatedRoute, i: number) {
  const tags: string[] = [];
  const floody = plan.floodCheck.zonesConsidered > 0 && plan.floodCheck.status !== 'clear';
  if (i === plan.recommendedIndex && !r.exposure.blocked) tags.push(floody ? 'Safest · Recommended' : 'Recommended');
  if (r.id === plan.baselineId) tags.push(r.exposure.exposedM > 0 ? 'Fastest · flooded' : 'Fastest');
  if (r.origin === 'detour' || r.origin === 'graph') tags.push('Flood detour');
  return tags.length ? tags.join(' · ') : 'Alternative';
}

/** Fastest-vs-safest summary. Shown on the route screen and at the top of Flood Analysis. */
export function RouteSafetyCard({ compact = false }: { compact?: boolean }) {
  const route = useStore((s) => s.route);
  const origin = useStore((s) => s.origin);
  const destination = useStore((s) => s.destination);
  const selectedId = useStore((s) => s.selectedRouteId);
  const plan = route.data;

  if (!destination || !origin) {
    return (
      <div className="callout">
        <Icon name="route" size={18} />
        <div>
          <strong>See the safest route</strong>
          <p className="small">Pick a start and destination — EssentialRoute will check the fastest route against your flood zones and suggest a safer alternative when it is flooded.</p>
          <button type="button" className="btn btn-ghost" onClick={() => setState({ tab: 'map', searchOpen: true })}>
            <Icon name="search" size={16} /> Choose route
          </button>
        </div>
      </div>
    );
  }
  if (route.status === 'loading' && (!plan || route.progress)) {
    return (
      <div className="callout" aria-live="polite">
        <span className="spinner" />
        <div>
          <strong>Checking flood-safe routes…</strong>
          <p className="small">{route.progress ?? 'Working…'}</p>
        </div>
      </div>
    );
  }
  if (route.status === 'error') {
    return (
      <div className="callout error" role="alert">
        <Icon name="warn" size={18} />
        <div>
          <strong>Route could not be calculated</strong>
          <p className="small">{route.error}</p>
          <button type="button" className="btn btn-ghost" onClick={() => computeRoute()}>
            <Icon name="refresh" size={16} /> Try again
          </button>
        </div>
      </div>
    );
  }
  if (!plan) return null;
  const fc = plan.floodCheck;
  const rec = plan.routes[plan.recommendedIndex];
  const fastest = plan.routes.find((r) => r.id === plan.baselineId) ?? rec;
  const dT = rec.duration - fastest.duration;
  const dD = rec.distance - fastest.distance;
  const zoneLabel = (ids: string[]) => {
    const names = ids.map((id) => activeZones().find((z) => z.id === id)?.label).filter(Boolean) as string[];
    return names.length ? names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '') : 'a flood zone';
  };
  const delta = `${dT >= 0 ? '+' : '−'}${formatDuration(Math.abs(dT))} · ${dD >= 0 ? '+' : '−'}${formatDistance(Math.abs(dD))}`;
  const show = (id: string) => {
    haptic(8);
    setState({ selectedRouteId: id, tab: 'map', sheetSnap: 'half' });
  };

  if (fc.status === 'no-zones')
    return (
      <div className="callout">
        <Icon name="info" size={18} />
        <div>
          <strong>No flood zones active</strong>
          <p className="small">Turn on the simulation and place zones (or load the illustrative scenario) to see how your route changes.</p>
        </div>
      </div>
    );
  if (fc.status === 'clear')
    return (
      <div className="callout ok safety-card">
        <Icon name="shield" size={18} />
        <div>
          <strong>Your fastest route is clear</strong>
          <p className="small">{formatDuration(fastest.duration)} · {formatDistance(fastest.distance)} — it does not cross any of the {fc.zonesConsidered} active flood zone{fc.zonesConsidered > 1 ? 's' : ''}.</p>
        </div>
      </div>
    );

  const tone = fc.status === 'avoided' ? 'ok' : fc.status === 'penalised' ? 'warn' : 'error';
  return (
    <div className={`callout ${tone} safety-card`}>
      <Icon name={fc.status === 'avoided' ? 'shield' : 'warn'} size={18} />
      <div>
        <strong>{fc.status === 'avoided' ? 'Flooded ahead — safer route found' : fc.status === 'penalised' ? 'Flooding unavoidable — least exposed route' : 'No flood-free route found'}</strong>
        {fc.status !== 'no-clean-route' && (
          <div className="cmp">
            <button type="button" className={`cmp-row ${selectedId === rec.id ? 'is-on' : ''}`} onClick={() => show(rec.id)}>
              <span className="cmp-tag good">{fc.status === 'avoided' ? 'Safest' : 'Least exposed'}</span>
              <strong>{formatDuration(rec.duration)}</strong>
              <span className="muted small">{formatDistance(rec.distance)}</span>
              <span className="small cmp-note">{rec.exposure.exposedM === 0 ? 'No flood exposure' : `${formatDistance(rec.exposure.exposedM)} in flood zone`}</span>
            </button>
            {fastest.id !== rec.id && (
              <button type="button" className={`cmp-row ${selectedId === fastest.id ? 'is-on' : ''}`} onClick={() => show(fastest.id)}>
                <span className="cmp-tag bad">Fastest</span>
                <strong>{formatDuration(fastest.duration)}</strong>
                <span className="muted small">{formatDistance(fastest.distance)}</span>
                <span className="small cmp-note">{fastest.exposure.blocked ? `Crosses ${zoneLabel(fastest.exposure.zoneIds)} · ${formatDistance(fastest.exposure.blockedM)} impassable` : `${formatDistance(fastest.exposure.exposedM)} in ${zoneLabel(fastest.exposure.zoneIds)}`}</span>
              </button>
            )}
          </div>
        )}
        {fastest.id !== rec.id && fc.status !== 'no-clean-route' && <p className="small">Safer route costs <strong>{delta}</strong> compared with the fastest.</p>}
        {!compact && <p className="small muted">{fc.message}</p>}
        {fc.status === 'no-clean-route' && <p className="small">{plan.reason}</p>}
      </div>
    </div>
  );
}

export function RoutePanel() {
  const route = useStore((s) => s.route);
  const selectedId = useStore((s) => s.selectedRouteId);
  const origin = useStore((s) => s.origin);
  const destination = useStore((s) => s.destination);
  const originMode = useStore((s) => s.originMode);
  const fix = useStore((s) => s.geo.fix);
  const routedFrom = useStore((s) => s.routedFrom);
  const graphStatus = useStore((s) => s.graph.status);
  const [showSteps, setShowSteps] = useState(false);

  if (!destination) return <StartPanel />;
  if (!origin)
    return (
      <div className="panel-pad">
        <h2 className="panel-title">{destination.name}</h2>
        <p className="muted">{destination.context}</p>
        <div className="callout">
          <Icon name="info" size={18} />
          <span>Choose a starting point to calculate a route.</span>
        </div>
        <div className="btn-row">
          <button type="button" className="btn btn-primary" onClick={useMyLocation}>
            <Icon name="locate" size={18} /> Use my location
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setState({ searchOpen: true })}>
            Choose start
          </button>
        </div>
      </div>
    );

  if (route.status === 'loading' && !route.data)
    return (
      <div className="panel-pad" aria-busy="true">
        <div className="loading-row" aria-live="polite">
          <span className="spinner" /> {route.progress ?? 'Calculating route…'}
        </div>
        <div className="skeleton h48" />
        <div className="skeleton h24" />
        <div className="skeleton h24 w60" />
      </div>
    );

  if (route.status === 'error')
    return (
      <div className="panel-pad">
        <div className="callout error" role="alert">
          <Icon name="warn" size={18} />
          <div>
            <strong>Route could not be calculated</strong>
            <p>{route.error}</p>
            <p className="small muted">No distance or time is shown because the routing service did not return a result.</p>
          </div>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => computeRoute()}>
          <Icon name="refresh" size={18} /> Try again
        </button>
      </div>
    );

  const plan = route.data;
  if (!plan) return null;
  const sel = plan.routes.find((r) => r.id === selectedId) ?? plan.routes[plan.recommendedIndex];
  const baseline = plan.routes.find((r) => r.id === plan.baselineId);
  const movedSinceRoute = originMode === 'live' && fix && routedFrom ? haversine(routedFrom, fix) : 0;
  const fc = plan.floodCheck;

  return (
    <div className="panel-pad route-panel">
      {route.status === 'loading' && (
        <div className="loading-row slim" aria-live="polite">
          <span className="spinner" /> {route.progress ?? 'Updating…'}
        </div>
      )}
      <div className="route-summary">
        <div>
          <div className="route-time">{formatDuration(sel.duration)}</div>
          <div className="route-dist">
            {formatDistance(sel.distance)} · {plan.mode === 'car' ? 'Drive' : 'Walk'}
          </div>
        </div>
        <div className="route-to">
          <span className="muted small">To</span>
          <strong>{plan.to.name}</strong>
        </div>
      </div>
      <ExposureBadge r={sel} />

      <div className="go-row">
        <button
          type="button"
          className="btn btn-go"
          disabled={sel.exposure.blocked || route.status === 'loading'}
          onClick={() => {
            haptic(15);
            startNavigation();
          }}
        >
          <Icon name="start" size={18} /> Start
        </button>
        <button type="button" className="btn btn-ghost" onClick={startPreview}>
          <Icon name="map" size={18} /> Preview turns
        </button>
      </div>
      <button type="button" className="link-btn demo-link" disabled={sel.exposure.blocked} onClick={startDemoDrive}>
        <Icon name="play" size={14} /> Demo drive · simulated GPS, for presenting indoors
      </button>
      {sel.exposure.blocked && <p className="small error-text">This route crosses an impassable flood zone — pick a safe route below to start navigation.</p>}

      {fc.zonesConsidered > 0 && <RouteSafetyCard compact />}

      {fc.zonesConsidered === 0 && (
      <div className={`callout ${fc.status === 'no-clean-route' ? 'error' : fc.status === 'penalised' ? 'warn' : fc.status === 'avoided' ? 'ok' : ''}`}>
        <Icon name={fc.status === 'no-clean-route' ? 'warn' : fc.status === 'no-zones' ? 'info' : 'shield'} size={18} />
        <div>
          <strong>Why this route</strong>
          <p>{plan.reason}</p>
          {fc.zonesConsidered > 0 && <p className="small muted">{fc.message}</p>}
        </div>
      </div>
      )}

      {fc.status === 'no-clean-route' && !plan.graphPath && (
        <button
          type="button"
          className="btn btn-ghost full"
          disabled={graphStatus === 'loading'}
          onClick={async () => {
            try {
              await ensureGraph();
              await computeRoute({ fit: true });
            } catch {
              /* graph error shown in Flood Analysis */
            }
          }}
        >
          {graphStatus === 'loading' ? <span className="spinner" /> : <Icon name="route" size={18} />}
          {graphStatus === 'loading' ? 'Downloading road network…' : 'Search the major-road graph (A*)'}
        </button>
      )}
      {plan.graphPath && (
        <div className="callout ok">
          <Icon name="route" size={18} />
          <div>
            <strong>Graph path found · {formatDistance(plan.graphPath.distance)}</strong>
            <p className="small">Shown as a dotted green line. Computed by A* on the OSM major-road network with impassable roads removed. Ignores one-way rules — check before travelling. No travel time is estimated.</p>
          </div>
        </div>
      )}

      {movedSinceRoute > 50 && (
        <button type="button" className="btn btn-ghost full" onClick={() => computeRoute({ fit: false })}>
          <Icon name="refresh" size={18} /> Recalculate from current position ({formatDistance(movedSinceRoute)} moved)
        </button>
      )}

      {plan.routes.length > 1 && (
        <div className="route-options" role="radiogroup" aria-label="Route options">
          {plan.routes.map((r, i) => (
            <button
              type="button"
              role="radio"
              aria-checked={r.id === sel.id}
              key={r.id}
              className={`route-opt ${r.id === sel.id ? 'is-on' : ''} ${r.exposure.blocked ? 'is-blocked' : ''}`}
              onClick={() => {
                haptic(8);
                setState({ selectedRouteId: r.id });
              }}
            >
              <span className="route-opt-main">
                <strong>{formatDuration(r.duration)}</strong>
                <span className="muted">{formatDistance(r.distance)}</span>
              </span>
              <span className="route-opt-tag">{routeLabel(plan, r, i)}</span>
              <ExposureBadge r={r} />
            </button>
          ))}
        </div>
      )}

      {baseline && baseline.id !== sel.id && baseline.exposure.exposedM > 0 && (
        <p className="small muted compare-note">
          Dashed blue line = fastest engine route ({formatDuration(baseline.duration)}, {formatDistance(baseline.distance)}), shown for comparison with its flooded sections in red.
        </p>
      )}

      <button type="button" className="disclosure" aria-expanded={showSteps} onClick={() => setShowSteps((v) => !v)}>
        <Icon name="chevron" size={16} className={showSteps ? 'rot90' : ''} /> Directions ({sel.steps.length} steps)
      </button>
      {showSteps && (
        <ol className="steps">
          {sel.steps.map((st, i) => (
            <li key={i}>
              <span>{st.instruction}</span>
              {st.distance > 0 && <span className="muted small">{formatDistance(st.distance)}</span>}
            </li>
          ))}
        </ol>
      )}

      <p className="small muted source-note">
        Routing: {sel.provider} · calculated {formatTime(plan.requestedAt)}. Times are free-flow estimates from OpenStreetMap road data — no live traffic is included.
        {fc.zonesConsidered > 0 && ' Flood checks use simulated and/or user-reported zones, not live observations.'}
      </p>
    </div>
  );
}

function StartPanel() {
  const recents = useStore((s) => s.recents);
  const list = recents.length ? recents : POPULAR_PLACES.slice(0, 5);
  return (
    <div className="panel-pad">
      <InstallButton />
      <h2 className="panel-title">Where to?</h2>
      <p className="muted small">Search any Mumbai place, or pick one below. Long-press the map to drop a pin.</p>
      <div className="quick-list">
        <div className="sugg-head">{recents.length ? 'Recent' : 'Suggested in Mumbai · preset locations'}</div>
        {list.map((p) => (
          <button type="button" key={p.id} className="list-row" onClick={() => setDestination(p)}>
            <span className={`sugg-ic ${recents.length ? 'recent' : 'popular'}`}>
              <Icon name={recents.length ? 'hist' : 'star'} size={16} />
            </span>
            <span className="sugg-text">
              <span className="sugg-name">{p.name}</span>
              <span className="sugg-ctx">{p.context}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
