import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { POPULAR_PLACES } from '../data/places';
import { ServiceError } from '../lib/http';
import { searchPlaces } from '../services/geocoding';
import { useStore } from '../state/store';
import type { Place } from '../types';
import { Icon } from './Icon';

type Row = { kind: 'gps' } | { kind: 'place'; place: Place; group: 'live' | 'recent' | 'popular' };

interface Props {
  role: 'origin' | 'destination';
  value: Place | null;
  onSelect: (p: Place) => void;
  onClear: () => void;
  onUseLocation?: () => void;
  placeholder: string;
  autoFocus?: boolean;
  live?: boolean;
  onFocusChange?: (focused: boolean) => void;
}

/** Accessible combobox with debounced live search (Photon / OSM). */
export function PlaceInput({ role, value, onSelect, onClear, onUseLocation, placeholder, autoFocus, live, onFocusChange }: Props) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(value?.name ?? '');
  const [focused, setFocused] = useState(false);
  const [results, setResults] = useState<Place[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [error, setError] = useState('');
  const [active, setActive] = useState(-1);
  const recents = useStore((s) => s.recents);
  const near = useStore((s) => s.geo.fix);
  const editing = useRef(false);
  const pendingEnter = useRef(false);

  // reflect external value changes (swap, service selection, GPS naming)
  useEffect(() => {
    if (!editing.current) setText(value?.name ?? '');
  }, [value]);

  useEffect(() => {
    // preventScroll: focusing must not make Android scroll the page while the keyboard opens
    if (autoFocus) inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  // keep the suggestion list exactly within the space above the on-screen keyboard
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const vv = window.visualViewport;
    let raf = 0;
    const fit = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const top = list.getBoundingClientRect().top;
        const avail = (vv ? vv.height + vv.offsetTop : window.innerHeight) - top - 10;
        list.style.maxHeight = `${Math.max(140, Math.round(avail))}px`;
      });
    };
    fit();
    vv?.addEventListener('resize', fit);
    window.addEventListener('resize', fit);
    return () => {
      cancelAnimationFrame(raf);
      vv?.removeEventListener('resize', fit);
      window.removeEventListener('resize', fit);
    };
  });

  const query = text.trim();
  const searching = editing.current && query.length >= 3 && query !== value?.name;

  useEffect(() => {
    if (!searching) {
      setStatus('idle');
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    setStatus('loading');
    const t = setTimeout(async () => {
      try {
        const r = await searchPlaces(query, ctrl.signal, near ?? undefined);
        setResults(r);
        setStatus('ok');
        setActive(-1);
        if (pendingEnter.current && r.length) {
          pendingEnter.current = false;
          editing.current = false;
          onSelect(r[0]);
          setText(r[0].name);
          setResults([]);
          setStatus('idle');
          inputRef.current?.blur();
        }
      } catch (e) {
        if (e instanceof ServiceError && e.kind === 'aborted') return;
        setError(e instanceof Error ? e.message : 'Search failed.');
        setStatus('error');
      }
    }, 380);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searching]);

  const rows: Row[] = useMemo(() => {
    if (searching) return results.map((p) => ({ kind: 'place' as const, place: p, group: 'live' as const }));
    if (query.length > 0 && query !== value?.name) return [];
    const out: Row[] = [];
    if (role === 'origin' && onUseLocation) out.push({ kind: 'gps' });
    recents.slice(0, 4).forEach((p) => out.push({ kind: 'place', place: p, group: 'recent' }));
    const recentIds = new Set(recents.map((r) => r.id));
    POPULAR_PLACES.filter((p) => !recentIds.has(p.id))
      .slice(0, role === 'origin' ? 4 : 6)
      .forEach((p) => out.push({ kind: 'place', place: p, group: 'popular' }));
    return out;
  }, [searching, results, query, value, role, onUseLocation, recents]);

  const open = focused && (rows.length > 0 || status === 'loading' || status === 'error' || (status === 'ok' && searching));

  const choose = (r: Row) => {
    editing.current = false;
    setFocused(false);
    if (r.kind === 'gps') onUseLocation?.();
    else {
      onSelect(r.place);
      setText(r.place.name);
    }
    setResults([]);
    setStatus('idle');
    inputRef.current?.blur();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && searching && (status !== 'ok' || results.length === 0) && status !== 'error') {
      e.preventDefault();
      pendingEnter.current = true; // pick the top result as soon as it arrives
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(rows.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' && rows.length) {
      e.preventDefault();
      choose(rows[Math.max(0, active)]);
    } else if (e.key === 'Escape') {
      inputRef.current?.blur();
    }
  };

  let lastGroup = '';
  return (
    <div className={`place-input ${open ? 'is-open' : ''}`}>
      <div className="place-field">
        <span className={`place-dot ${role}`} aria-hidden="true" />
        <input
          ref={inputRef}
          id={id}
          type="text"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${id}-opt-${active}` : undefined}
          aria-label={role === 'origin' ? 'Starting point' : 'Destination'}
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            editing.current = true;
            pendingEnter.current = false;
            setText(e.target.value);
          }}
          onFocus={(e) => {
            setFocused(true);
            onFocusChange?.(true);
            e.currentTarget.select();
          }}
          onBlur={() => {
            // delay so taps on options register
            setTimeout(() => {
              setFocused(false);
              onFocusChange?.(false);
              if (editing.current && value) setText(value.name);
              editing.current = false;
            }, 160);
          }}
          onKeyDown={onKey}
        />
        {live && <span className="live-badge" title="Origin follows your live GPS position">LIVE</span>}
        {(text || value) && (
          <button
            type="button"
            className="icon-btn sm"
            aria-label={`Clear ${role === 'origin' ? 'starting point' : 'destination'}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              editing.current = false;
              setText('');
              onClear();
              inputRef.current?.focus({ preventScroll: true });
            }}
          >
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
      {open && (
        <ul ref={listRef} className="suggestions" id={`${id}-list`} role="listbox" aria-label="Suggestions" onMouseDown={(e) => e.preventDefault()}>
          {status === 'loading' && searching && (
            <li className="sugg-state" aria-live="polite">
              <span className="spinner" /> Searching Mumbai…
            </li>
          )}
          {status === 'error' && searching && (
            <li className="sugg-state error" role="alert">
              <Icon name="warn" size={16} /> {error}
            </li>
          )}
          {status === 'ok' && searching && rows.length === 0 && <li className="sugg-state">No places found for “{query}”. Try a landmark, station or area name.</li>}
          {rows.map((r, i) => {
            const group = r.kind === 'gps' ? 'gps' : r.group;
            const header =
              group !== lastGroup && group !== 'gps'
                ? group === 'live'
                  ? 'Search results · OpenStreetMap'
                  : group === 'recent'
                    ? 'Recent'
                    : 'Suggested in Mumbai · preset locations'
                : null;
            lastGroup = group;
            return (
              <li key={r.kind === 'gps' ? 'gps' : `${r.group}-${r.place.id}`} role="presentation">
                {header && <div className="sugg-head">{header}</div>}
                <div
                  id={`${id}-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={`sugg ${i === active ? 'is-active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(r)}
                >
                  <span className={`sugg-ic ${r.kind === 'gps' ? 'gps' : r.group}`}>
                    <Icon name={r.kind === 'gps' ? 'locate' : r.group === 'recent' ? 'hist' : r.group === 'popular' ? 'star' : 'pin'} size={16} />
                  </span>
                  <span className="sugg-text">
                    <span className="sugg-name">{r.kind === 'gps' ? 'Use my location' : r.place.name}</span>
                    <span className="sugg-ctx">{r.kind === 'gps' ? 'Live GPS · follows you as you move' : r.place.context}</span>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
