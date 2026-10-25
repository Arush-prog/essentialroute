import 'leaflet/dist/leaflet.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Progressive Web App: cache the app shell so it opens instantly and offline-shows its error states.
if ('serviceWorker' in navigator && !__DEV__) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

// Opt-in inspection hook for demos and testing: open the app with ?debug=1
if (new URLSearchParams(location.search).has('debug')) {
  void Promise.all([import('./state/store'), import('./state/actions'), import('./lib/compass')]).then(([m, a, c]) => {
    (window as unknown as { __essentialroute: unknown }).__essentialroute = { getState: m.getState, addSimZone: a.addSimZone, compassHeading: c.compassHeading };
  });
}
