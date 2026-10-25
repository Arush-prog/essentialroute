import { useState } from 'react';
import { REPORT_STALE_MS } from '../config';
import { SEVERITY, SEVERITY_ORDER } from '../analysis/flood';
import { mapRef } from '../map/mapRef';
import { formatAgo, formatTime } from '../lib/geo';
import { addReport, removeReport } from '../state/actions';
import { flyTo, setState, useStore } from '../state/store';
import type { Severity } from '../types';
import { Icon } from './Icon';

export function AlertsPanel() {
  const reports = useStore((s) => s.reports);
  const draft = useStore((s) => s.reportDraft);
  const placing = useStore((s) => s.reportPlacing);
  const fix = useStore((s) => s.geo.fix);
  const simZones = useStore((s) => s.sim.zones);
  const simEnabled = useStore((s) => s.sim.enabled);
  const [severity, setSev] = useState<Severity>('high');
  const [note, setNote] = useState('');
  const now = Date.now();

  const useCentre = () => {
    const c = mapRef.current?.getCenter();
    if (c) setState({ reportDraft: { lat: c.lat, lon: c.lng } });
  };

  return (
    <div className="panel-pad">
      <section className="card-sec">
        <h2 className="panel-title">Official sources</h2>
        <div className="callout">
          <Icon name="info" size={18} />
          <div>
            <p className="small"><strong>No live official alert feed is connected to this prototype.</strong> EssentialRoute does not show rainfall, sensor or road-closure data it cannot verify.</p>
            <p className="small">For official warnings follow BMC Disaster Management and IMD Mumbai. In an emergency call <strong>112</strong>.</p>
          </div>
        </div>
      </section>

      <section className="card-sec">
        <h2 className="panel-title">Report waterlogging</h2>
        <p className="small muted">Reports stay on this device only, are labelled unverified, and are used to steer your own routes. They are not shared with anyone.</p>
        {!draft ? (
          <div className="btn-row wrap">
            <button type="button" className="btn btn-ghost" disabled={!fix} onClick={() => fix && setState({ reportDraft: { lat: fix.lat, lon: fix.lon } })} title={fix ? undefined : 'Enable live location first'}>
              <Icon name="locate" size={16} /> At my location
            </button>
            <button type="button" className={`btn ${placing ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setState((s) => ({ reportPlacing: !s.reportPlacing, sim: { ...s.sim, placing: false } }))}>
              <Icon name="target" size={16} /> {placing ? 'Tap the map…' : 'Pick on map'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={useCentre}>
              <Icon name="pin" size={16} /> Map centre
            </button>
          </div>
        ) : (
          <form
            className="report-form"
            onSubmit={(e) => {
              e.preventDefault();
              addReport(draft, severity, note);
              setNote('');
            }}
          >
            <p className="small">
              Location: {draft.lat.toFixed(5)}, {draft.lon.toFixed(5)}{' '}
              <button type="button" className="link-btn" onClick={() => flyTo(draft.lat, draft.lon, 16)}>show</button>
            </p>
            <div className="field-label">How bad is it?</div>
            <div className="seg sev" role="radiogroup" aria-label="Reported severity">
              {SEVERITY_ORDER.map((sv) => (
                <button key={sv} type="button" role="radio" aria-checked={severity === sv} className={severity === sv ? 'is-on' : ''} onClick={() => setSev(sv)}>
                  {SEVERITY[sv].label}
                </button>
              ))}
            </div>
            <label className="text-field">
              <span className="field-label">Note (optional)</span>
              <input type="text" maxLength={80} value={note} placeholder="e.g. knee-deep water under the bridge" onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="btn-row">
              <button type="submit" className="btn btn-primary">Save report</button>
              <button type="button" className="btn btn-ghost" onClick={() => setState({ reportDraft: null })}>Cancel</button>
            </div>
          </form>
        )}
      </section>

      <section className="card-sec">
        <h2 className="panel-title">Your reports <span className="tag rep">USER-REPORTED · UNVERIFIED</span></h2>
        {reports.length === 0 ? (
          <p className="muted small">No reports yet.</p>
        ) : (
          <ul className="alert-list">
            {reports.map((r) => {
              const stale = now - r.createdAt > REPORT_STALE_MS;
              return (
                <li key={r.id} className={stale ? 'is-stale' : ''}>
                  <button type="button" className="alert-main" onClick={() => flyTo(r.lat, r.lon, 16)}>
                    <strong>{r.label}</strong>
                    <span className="small muted">
                      {SEVERITY[r.severity ?? 'high'].label} · {formatTime(r.createdAt)} ({formatAgo(r.createdAt, now)}){stale ? ' · STALE — may no longer apply' : ''}
                    </span>
                  </button>
                  <button type="button" className="icon-btn sm" aria-label="Delete report" onClick={() => removeReport(r.id)}>
                    <Icon name="trash" size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card-sec">
        <h2 className="panel-title">Simulated events <span className="tag sim">SIMULATED</span></h2>
        {simZones.length === 0 ? (
          <p className="muted small">No simulated zones. Create a scenario in Flood Analysis.</p>
        ) : (
          <ul className="alert-list">
            {simZones.map((z) => (
              <li key={z.id}>
                <button type="button" className="alert-main" onClick={() => flyTo(z.lat, z.lon, 15)}>
                  <strong>{z.label}</strong>
                  <span className="small muted">Scenario zone · created {formatTime(z.createdAt)}{simEnabled ? '' : ' · simulation off'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="small muted disclaimer">EssentialRoute is a hackathon prototype and is not a substitute for official emergency instructions.</p>
    </div>
  );
}
