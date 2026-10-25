import { useEffect } from 'react';
import { clearRoute } from '../state/actions';
import { stopNavigation } from '../state/navigation';
import { getState, setState, subscribe, type AppState } from '../state/store';

/**
 * Android back button / back gesture support.
 *
 * Without this, pressing Back in the installed app (or Chrome) leaves EssentialRoute entirely.
 * Each open "layer" (search, service card, non-map tab, active route) gets a history entry;
 * Back closes the topmost layer, like a native Android app.
 */
function depth(s: AppState): number {
  return (s.nav.active ? 1 : 0) + (s.searchOpen ? 1 : 0) + (s.selectedService ? 1 : 0) + (s.tab !== 'map' ? 1 : 0) + (s.destination ? 1 : 0);
}

function closeTop(s: AppState) {
  if (s.nav.active) stopNavigation();
  else if (s.searchOpen) setState({ searchOpen: false });
  else if (s.selectedService) setState({ selectedService: null });
  else if (s.tab !== 'map') setState({ tab: 'map', sheetSnap: s.destination ? 'half' : 'peek' });
  else if (s.destination) clearRoute();
}

export function useBackButton(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let pushed = 0;
    let ignorePops = 0;
    let handlingPop = false;

    const sync = () => {
      const d = depth(getState());
      if (d > pushed) {
        for (; pushed < d; pushed++) history.pushState({ er: pushed + 1 }, '');
      } else if (d < pushed) {
        if (handlingPop) {
          pushed = d;
          return;
        }
        // layer closed from the UI: drop our now-unneeded history entries silently
        const n = pushed - d;
        pushed = d;
        ignorePops++;
        history.go(-n);
      }
    };

    const onPop = () => {
      if (ignorePops > 0) {
        ignorePops--;
        return;
      }
      if (pushed === 0) return; // nothing of ours left — let the browser leave the app
      pushed--;
      handlingPop = true;
      try {
        closeTop(getState());
      } finally {
        handlingPop = false;
      }
      sync();
    };

    window.addEventListener('popstate', onPop);
    const unsub = subscribe(sync);
    sync();
    return () => {
      unsub();
      window.removeEventListener('popstate', onPop);
    };
  }, [enabled]);
}
