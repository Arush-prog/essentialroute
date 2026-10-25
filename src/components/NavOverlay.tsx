import { formatDistance, formatDuration } from '../lib/geo';
import { haptic } from '../lib/haptic';
import { goToStep, navDistance, selectedRoute, startDemoDrive, startPreview, stopNavigation, toggleVoice } from '../state/navigation';
import { flyTo, getState, setState, useStore } from '../state/store';
import type { RouteStep } from '../types';
import { Icon } from './Icon';

/** Turn arrow for an OSRM maneuver. */
export function TurnIcon({ step, size = 40 }: { step?: RouteStep; size?: number }) {
  const type = step?.type ?? 'straight';
  const mod = step?.modifier ?? 'straight';
  const left = mod.includes('left');
  let d: string[];
  if (type === 'arrive') d = ['M12 21s-6-5.6-6-10.2a6 6 0 0 1 12 0C18 15.4 12 21 12 21z', 'M12 13.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z'];
  else if (type.includes('roundabout') || type.includes('rotary')) d = ['M12 21v-6', 'M12 15a4.5 4.5 0 1 1 4.2-6', 'M17.5 4.5l-1.3 4.2-4.2-1.3'];
  else if (mod === 'uturn') d = ['M16 21V9a4 4 0 0 0-8 0v6', 'M4.5 12l3.5 3.5 3.5-3.5'];
  else if (mod.includes('sharp')) d = ['M7 21V8a4 4 0 0 1 8 0v8', 'M11 13l4 4 4-4'];
  else if (mod.includes('slight')) d = ['M8 21v-6.5l9-9', 'M11 5.5h6v6'];
  else if (mod === 'left' || mod === 'right') d = ['M7 21v-8a4 4 0 0 1 4-4h9', 'M16 5l4 4-4 4'];
  else d = ['M12 21V4', 'M6 10l6-6 6 6'];
  const flip = left && mod !== 'uturn' ? 'translate(24 0) scale(-1 1)' : mod === 'uturn' && !left ? 'translate(24 0) scale(-1 1)' : undefined;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <g transform={flip}>
        {d.map((p) => (
          <path key={p} d={p} />
        ))}
      </g>
    </svg>
  );
}

const arrivalTime = (s: number) => new Date(Date.now() + s * 1000).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

export function NavOverlay() {
  const nav = useStore((s) => s.nav);
  const plan = useStore((s) => s.route.data);
  const selectedId = useStore((s) => s.selectedRouteId);
  const geo = useStore((s) => s.geo);
  const follow = useStore((s) => s.follow);
  const destination = useStore((s) => s.destination);
  const routeStatus = useStore((s) => s.route.status);
  void selectedId;
  const r = selectedRoute();
  if (!nav.active || !plan || !r) return null;

  const fc = plan.floodCheck;
  const floodChip =
    fc.zonesConsidered === 0 ? null : r.exposure.exposedM === 0 ? (
      <span className="nav-chip ok">
        <Icon name="shield" size={14} /> {fc.status === 'avoided' ? 'Safe route · avoids flooding' : 'No flood zones on route'}
      </span>
    ) : (
      <span className="nav-chip warn">
        <Icon name="flood" size={14} /> {formatDistance(r.exposure.exposedM)} through flood zone
      </span>
    );

  const end = (
    <button
      type="button"
      className="nav-end"
      onClick={() => {
        haptic(15);
        stopNavigation();
      }}
    >
      {nav.arrived ? 'Done' : nav.mode === 'preview' ? 'Exit' : 'End'}
    </button>
  );

  /* ---------- preview: step through the turns ---------- */
  if (nav.mode === 'preview') {
    const st = r.steps[nav.step];
    return (
      <>
        <div className="nav-top" role="region" aria-label="Route preview">
          <div className="nav-banner preview">
            <div className="nav-turn">
              <TurnIcon step={st} />
            </div>
            <div className="nav-text">
              <div className="nav-dist">{st?.distance ? `then ${navDistance(st.distance)}` : 'Step'}</div>
              <div className="nav-instr">{st?.instruction}</div>
            </div>
          </div>
          {floodChip && <div className="nav-chips">{floodChip}</div>}
        </div>
        <div className="nav-bottom" role="region" aria-label="Preview controls">
          <button type="button" className="nav-btn" aria-label="Previous step" disabled={nav.step === 0} onClick={() => goToStep(nav.step - 1)}>
            <Icon name="back" size={22} />
          </button>
          <div className="nav-summary">
            <div className="nav-eta">
              Step {nav.step + 1} <span className="muted">of {r.steps.length}</span>
            </div>
            <div className="nav-sub">
              {formatDuration(r.duration)} · {formatDistance(r.distance)} total
            </div>
          </div>
          <button type="button" className="nav-btn" aria-label="Next step" disabled={nav.step >= r.steps.length - 1} onClick={() => goToStep(nav.step + 1)}>
            <Icon name="chevron" size={22} />
          </button>
          {end}
        </div>
      </>
    );
  }

  /* ---------- arrived ---------- */
  if (nav.arrived) {
    const mins = Math.max(1, Math.round((Date.now() - nav.startedAt) / 60000));
    return (
      <div className="arrive-wrap" role="dialog" aria-modal="false" aria-labelledby="arrive-title" aria-live="assertive">
        <div className="arrive-card">
          <div className="arrive-check" aria-hidden="true">
            <svg viewBox="0 0 52 52" width="64" height="64">
              <circle cx="26" cy="26" r="24" fill="none" stroke="#34d399" strokeWidth="4" className="arrive-ring" />
              <path d="M15 27.5 23 35 38 18" fill="none" stroke="#34d399" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" className="arrive-tick" />
            </svg>
          </div>
          <h2 id="arrive-title" className="arrive-title">You have arrived at your location</h2>
          <p className="arrive-place">{destination?.name}</p>
          {destination?.context && <p className="arrive-ctx">{destination.context}</p>}
          <div className="arrive-stats">
            <span>
              <strong>{formatDistance(r.distance)}</strong> travelled
            </span>
            <span>
              <strong>{nav.demo ? formatDuration(r.duration) : `${mins} min`}</strong> {nav.demo ? 'estimated' : 'trip time'}
            </span>
            {fc.zonesConsidered > 0 && (
              <span className={r.exposure.exposedM === 0 ? 'ok' : 'warn'}>
                <strong>{r.exposure.exposedM === 0 ? 'Avoided' : formatDistance(r.exposure.exposedM)}</strong> {r.exposure.exposedM === 0 ? 'all flood zones' : 'in flood zones'}
              </span>
            )}
          </div>
          {nav.demo && <p className="arrive-note">Demo drive — position was simulated.</p>}
          <button
            type="button"
            className="btn btn-go arrive-done"
            autoFocus
            onClick={() => {
              haptic(15);
              stopNavigation();
            }}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  /* ---------- live navigation ---------- */
  const p = nav.progress;
  const waiting = !p;
  const st = p ? r.steps[p.next] : undefined;
  const then = p ? r.steps[p.next + 1] : undefined;
  const gpsProblem = geo.status === 'denied' || geo.status === 'insecure' || geo.status === 'unsupported' || geo.status === 'unavailable';

  let banner;
  if (nav.arrived) {
    banner = (
      <div className="nav-banner arrived">
        <div className="nav-turn">
          <TurnIcon step={{ type: 'arrive' } as RouteStep} />
        </div>
        <div className="nav-text">
          <div className="nav-dist">You have arrived</div>
          <div className="nav-instr">{destination?.name}</div>
        </div>
      </div>
    );
  } else if (nav.rerouting || (routeStatus === 'loading' && !waiting)) {
    banner = (
      <div className="nav-banner">
        <div className="nav-turn">
          <span className="spinner lg" />
        </div>
        <div className="nav-text">
          <div className="nav-dist">Rerouting…</div>
          <div className="nav-instr">Finding the safest route from here</div>
        </div>
      </div>
    );
  } else if (waiting) {
    banner = (
      <div className="nav-banner">
        <div className="nav-turn">{gpsProblem ? <Icon name="warn" size={32} /> : <span className="spinner lg" />}</div>
        <div className="nav-text">
          <div className="nav-dist">{gpsProblem ? 'Location unavailable' : 'Waiting for GPS…'}</div>
          <div className="nav-instr">
            {gpsProblem ? 'Allow location access to navigate, or preview the turns instead.' : 'Hold the phone with a clear view of the sky.'}
          </div>
          <div className="nav-alts">
            <button type="button" className="btn btn-ghost btn-sm nav-alt" onClick={startDemoDrive}>
              Demo drive
            </button>
            <button type="button" className="btn btn-ghost btn-sm nav-alt" onClick={startPreview}>
              Preview turns
            </button>
          </div>
        </div>
      </div>
    );
  } else {
    banner = (
      <div className="nav-banner">
        <div className="nav-turn">
          <TurnIcon step={st} />
        </div>
        <div className="nav-text">
          <div className="nav-dist">{navDistance(p!.toNext)}</div>
          <div className="nav-instr">{st?.instruction ?? 'Continue'}</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="nav-top" role="region" aria-label="Navigation instructions" aria-live="polite">
        {banner}
        {!waiting && !nav.arrived && !nav.rerouting && then && (
          <div className="nav-then">
            Then <TurnIcon step={then} size={18} /> <span>{then.road ?? then.instruction}</span>
          </div>
        )}
        {(floodChip || nav.demo) && !nav.arrived && (
          <div className="nav-chips">
            {nav.demo && (
              <span className="nav-chip demo">
                <Icon name="play" size={14} /> DEMO DRIVE · simulated position
              </span>
            )}
            {floodChip}
          </div>
        )}
      </div>
      <div className="nav-bottom" role="region" aria-label="Trip summary">
        <div className="nav-summary">
          {p && !nav.arrived ? (
            <>
              <div className="nav-eta">{formatDuration(p.remainingS)}</div>
              <div className="nav-sub">
                {formatDistance(p.remainingM)} · arrive {arrivalTime(p.remainingS)}
              </div>
            </>
          ) : (
            <>
              <div className="nav-eta">{nav.arrived ? 'Arrived' : formatDuration(r.duration)}</div>
              <div className="nav-sub">{nav.arrived ? destination?.name : `${formatDistance(r.distance)} · free-flow estimate`}</div>
            </>
          )}
        </div>
        <button type="button" className={`nav-btn ${nav.voice ? 'is-on' : ''}`} aria-label={nav.voice ? 'Mute voice guidance' : 'Turn on voice guidance'} aria-pressed={nav.voice} onClick={toggleVoice}>
          <Icon name={nav.voice ? 'volume' : 'mute'} size={22} />
        </button>
        {!follow && geo.fix && (
          <button
            type="button"
            className="nav-btn"
            aria-label="Re-centre"
            onClick={() => {
              setState({ follow: true });
              const f = getState().geo.fix;
              if (f) flyTo(f.lat, f.lon, 17);
            }}
          >
            <Icon name="locate" size={22} />
          </button>
        )}
        {end}
      </div>
    </>
  );
}
