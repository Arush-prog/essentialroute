import { useState } from 'react';
import { clearRoute, fixOriginHere, setDestination, setOrigin, swapEnds, useMyLocation } from '../state/actions';
import { setState, useStore } from '../state/store';
import { Icon } from './Icon';
import { PlaceInput } from './PlaceInput';

/** Origin/destination search. Compact pill on mobile until tapped; always expanded on desktop. */
export function SearchPanel({ compactable }: { compactable: boolean }) {
  const origin = useStore((s) => s.origin);
  const destination = useStore((s) => s.destination);
  const originMode = useStore((s) => s.originMode);
  const travelMode = useStore((s) => s.travelMode);
  const open = useStore((s) => s.searchOpen);
  const geoStatus = useStore((s) => s.geo.status);
  const [focusDest, setFocusDest] = useState(false);

  const expanded = !compactable || open;

  if (!expanded) {
    return (
      <div className="search-compact">
        <button
          type="button"
          className="search-pill"
          onClick={() => {
            setFocusDest(!destination);
            setState({ searchOpen: true });
          }}
        >
          <Icon name="search" size={18} />
          {destination ? (
            <span className="pill-route">
              <span className="pill-from">{origin?.name ?? 'Choose start'}</span>
              <Icon name="chevron" size={14} />
              <span className="pill-to">{destination.name}</span>
            </span>
          ) : (
            <span className="pill-placeholder">Where to in Mumbai?</span>
          )}
        </button>
        {destination && (
          <button type="button" className="icon-btn" aria-label="Clear route" onClick={clearRoute}>
            <Icon name="close" size={18} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="search-card" role="search">
      {compactable && (
        <div className="search-card-head">
          <button type="button" className="icon-btn" aria-label="Close search and return to map" onClick={() => setState({ searchOpen: false })}>
            <Icon name="back" size={20} />
          </button>
          <span className="search-card-title">Plan a route</span>
          <ModeToggle mode={travelMode} />
        </div>
      )}
      <div className="search-fields">
        <div className="search-inputs">
          <PlaceInput
            role="origin"
            value={origin}
            live={originMode === 'live'}
            placeholder={geoStatus === 'requesting' && originMode === 'live' ? 'Getting your location…' : 'Choose starting point'}
            onSelect={(p) => {
              setOrigin(p);
              if (compactable && destination) setState({ searchOpen: false });
            }}
            onClear={() => setState({ origin: null, originMode: 'fixed' })}
            onUseLocation={() => {
              useMyLocation();
              if (compactable && destination) setState({ searchOpen: false });
            }}
          />
          <PlaceInput
            role="destination"
            value={destination}
            placeholder="Search destination"
            autoFocus={compactable && focusDest}
            onSelect={(p) => {
              setDestination(p);
              if (compactable && origin) setState({ searchOpen: false });
            }}
            onClear={() => setDestination(null)}
          />
        </div>
        <button type="button" className="icon-btn swap" aria-label="Swap start and destination" onClick={swapEnds} disabled={!origin && !destination}>
          <Icon name="swap" size={20} />
        </button>
      </div>
      <div className="search-actions">
        <button type="button" className={`chip ${originMode === 'live' ? 'is-on' : ''}`} onClick={originMode === 'live' ? fixOriginHere : useMyLocation} aria-pressed={originMode === 'live'}>
          <Icon name="locate" size={16} />
          {originMode === 'live' ? 'Live origin · tap to fix point' : 'Use my location'}
        </button>
        {!compactable && <ModeToggle mode={travelMode} />}
        {(origin || destination) && (
          <button
            type="button"
            className="chip"
            onClick={() => {
              setState({ origin: null, originMode: 'fixed' });
              clearRoute();
            }}
          >
            <Icon name="close" size={14} /> Clear
          </button>
        )}
      </div>
    </div>
  );
}

function ModeToggle({ mode }: { mode: 'car' | 'foot' }) {
  return (
    <div className="seg" role="radiogroup" aria-label="Travel mode">
      <button type="button" role="radio" aria-checked={mode === 'car'} className={mode === 'car' ? 'is-on' : ''} onClick={() => setState({ travelMode: 'car' })}>
        <Icon name="car" size={16} /> <span>Drive</span>
      </button>
      <button type="button" role="radio" aria-checked={mode === 'foot'} className={mode === 'foot' ? 'is-on' : ''} onClick={() => setState({ travelMode: 'foot' })}>
        <Icon name="walk" size={16} /> <span>Walk</span>
      </button>
    </div>
  );
}
