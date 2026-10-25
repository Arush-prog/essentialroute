import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { getState } from '../state/store';

/** GeoAI assistant — talks to the EssentialRoute FastAPI backend (Qwen2.5-1.5B-Instruct + live Open-Meteo rain). */
const API_URL = 'https://essentialroute-api.onrender.com/ask';

type Zone = { name: string; severity: string; now_mm_h?: number; last3h_mm?: number };
type Msg = { role: 'user' | 'ai'; text: string; zones?: Zone[]; error?: boolean; by?: string; source?: string };

/** The flood state the map is currently showing, so the assistant's answer matches it. */
function appFloodState() {
  const rain = getState().rain;
  return {
    mode: rain.mode,
    ok: rain.mode !== 'live' || rain.live.status === 'ok',
    zones: rain.zones.map((z) => ({ label: z.label, severity: z.severity, nowMmH: z.rain?.nowMmH, last3hMm: z.rain?.last3hMm, kind: z.kind })),
  };
}

const SUGGESTIONS = [
  'Is Andheri Subway safe right now?',
  'Best way from Dadar to Bandra avoiding floods?',
  'Which Mumbai junctions are flooded now?',
];

// Kept at module level so the conversation survives tab switches.
let history: Msg[] = [];

export function AskPanel() {
  const [msgs, setMsgs] = useState<Msg[]>(history);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    history = msgs;
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs, busy]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setInput('');
    setMsgs((m) => [...m, { role: 'user', text: question }]);
    setBusy(true);
    setSlow(false);
    // free-tier server sleeps when idle; tell the user if the first reply is slow
    const slowTimer = setTimeout(() => setSlow(true), 6000);
    try {
      const ctrl = new AbortController();
      const kill = setTimeout(() => ctrl.abort(), 90_000);
      const r = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, app_state: appFloodState() }),
        signal: ctrl.signal,
      });
      clearTimeout(kill);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setMsgs((m) => [...m, { role: 'ai', text: d.answer, zones: d.flood_zones, by: d.answered_by, source: d.data_source }]);
    } catch {
      setMsgs((m) => [...m, { role: 'ai', text: 'Could not reach the GeoAI assistant. Check your connection and try again.', error: true }]);
    } finally {
      clearTimeout(slowTimer);
      setBusy(false);
      setSlow(false);
    }
  }

  return (
    <div className="panel-pad ask-panel">
      <div className="ask-head">
        <span className="ask-badge">
          <Icon name="spark" size={16} /> GeoAI Assistant
        </span>
        <p className="muted ask-sub">Ask about flooding and safe routes in Mumbai. Answers use live rainfall at 11 flood hotspots · Qwen2.5-1.5B.</p>
      </div>

      <div className="ask-log" aria-live="polite">
        {msgs.length === 0 && (
          <div className="ask-sugg">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="chip" onClick={() => void ask(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`ask-msg ${m.role} ${m.error ? 'is-err' : ''}`}>
            <p>{m.text}</p>
            {m.zones && m.zones.some((z) => z.severity !== 'clear') && (
              <div className="ask-zones">
                {m.zones
                  .filter((z) => z.severity !== 'clear')
                  .map((z) => (
                    <span key={z.name} className={`ask-zone sev-${z.severity}`}>
                      {z.name}
                    </span>
                  ))}
              </div>
            )}
            {m.by && (
              <p className="ask-meta">
                {m.by === 'llm' ? 'Answered by Qwen2.5-1.5B' : 'Rule-based answer (AI model offline)'}
                {m.source && m.source !== 'unavailable' ? ` · ${m.source.includes('SIMULATED') ? 'simulated rain' : 'live rain'}` : ' · no rain data'}
              </p>
            )}
          </div>
        ))}
        {busy && (
          <div className="ask-msg ai is-busy">
            <p>{slow ? 'Waking up the AI server — first reply can take up to a minute…' : 'Thinking…'}</p>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        <input
          className="ask-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Is it safe to drive to Sion now?"
          aria-label="Ask the GeoAI assistant"
          enterKeyHint="send"
        />
        <button type="submit" className="btn btn-primary ask-send" disabled={busy || !input.trim()} aria-label="Send">
          <Icon name="send" size={18} />
        </button>
      </form>
    </div>
  );
}
