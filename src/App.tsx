import { useEffect, useState } from 'react';
import { MapView } from './map/MapView';
import { AlertsPanel } from './components/AlertsPanel';
import { ExplorePanel, ServiceCard } from './components/ExplorePanel';
import { FloodPanel } from './components/FloodPanel';
import { AskPanel } from './components/AskPanel';
import { Icon } from './components/Icon';
import { RoutePanel } from './components/RoutePanel';
import { SearchPanel } from './components/SearchPanel';
import { Banners, BottomSheet, Brand, GeoStatusChip, MapControls, StatusPill, TabBar, Toast } from './components/Shell';
import { useGeolocationLifecycle } from './hooks/useGeolocation';
import { useBackButton } from './hooks/useBackButton';
import { loadServices, refreshLiveRain, useController } from './state/actions';
import { initNavigation } from './state/navigation';
import { NavOverlay } from './components/NavOverlay';
import { getState, setState, subscribe, useStore } from './state/store';

function useIsDesktop() {
  const q = '(min-width: 900px)';
  const [d, setD] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setD(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return d;
}

function TabContent() {
  const tab = useStore((s) => s.tab);
  const selected = useStore((s) => s.selectedService);
  switch (tab) {
    case 'explore':
      return <ExplorePanel />;
    case 'flood':
      return <FloodPanel />;
    case 'ask':
      return <AskPanel />;
    case 'alerts':
      return <AlertsPanel />;
    default:
      return selected ? (
        <div className="panel-pad">
          <ServiceCard svc={selected} />
        </div>
      ) : (
        <RoutePanel />
      );
  }
}

/** Opens the sheet to a useful height when something new needs attention. */
function useSheetAutoSnap() {
  useEffect(() => {
    let prevPlan = getState().route.data;
    let prevSvc = getState().selectedService;
    let prevStatus = getState().route.status;
    let prevDraft = getState().reportDraft;
    return subscribe(() => {
      const s = getState();
      if (s.route.data !== prevPlan && s.route.data && s.sheetSnap === 'peek') setState({ sheetSnap: 'half' });
      if (s.route.status === 'error' && prevStatus !== 'error' && s.sheetSnap === 'peek') setState({ sheetSnap: 'half' });
      if (s.selectedService && s.selectedService !== prevSvc && s.sheetSnap === 'peek') setState({ sheetSnap: 'half' });
      if (s.reportDraft && s.reportDraft !== prevDraft && s.sheetSnap === 'peek') setState({ sheetSnap: 'half' });
      prevPlan = s.route.data;
      prevSvc = s.selectedService;
      prevStatus = s.route.status;
      prevDraft = s.reportDraft;
    });
  }, []);
}

export function App() {
  const desktop = useIsDesktop();
  const tab = useStore((s) => s.tab);
  const searchOpen = useStore((s) => s.searchOpen);
  const snap = useStore((s) => s.sheetSnap);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  useController();
  useGeolocationLifecycle();
  useSheetAutoSnap();
  useBackButton(!desktop);

  const navActive = useStore((s) => s.nav.active);

  // essential services are part of the default map experience
  useEffect(() => {
    void loadServices();
    // live rainfall drives rain-aware routing; refresh every 10 minutes while it is in use
    void refreshLiveRain();
    const rainTimer = setInterval(() => {
      if (getState().rain.mode === 'live' && document.visibilityState === 'visible') void refreshLiveRain();
    }, 10 * 60_000);
    const stopNav = initNavigation();
    return () => {
      clearInterval(rainTimer);
      stopNav();
    };
  }, []);

  if (navActive) {
    return (
      <div className={`app ${desktop ? 'desktop' : 'mobile'} is-nav`}>
        <MapView />
        <NavOverlay />
        <Toast />
      </div>
    );
  }

  if (desktop) {
    return (
      <div className="app desktop">
        <MapView />
        <aside className={`sidebar ${sidebarOpen ? '' : 'is-collapsed'}`} aria-label="Route planning and analysis">
          <header className="side-head">
            <Brand />
            <button type="button" className="icon-btn" aria-label="Collapse sidebar" onClick={() => setState({ sidebarOpen: false })}>
              <Icon name="sidebar" size={20} />
            </button>
          </header>
          <div className="side-status">
            <StatusPill />
          </div>
          <TabBar variant="side" />
          <div className="side-body">
            {tab === 'map' && <SearchPanel compactable={false} />}
            <TabContent />
          </div>
        </aside>
        {!sidebarOpen && (
          <button type="button" className="sidebar-open btn btn-surface" onClick={() => setState({ sidebarOpen: true })} aria-label="Open sidebar">
            <Icon name="sidebar" size={18} /> <Brand />
          </button>
        )}
        <div className="desk-geo">
          <GeoStatusChip />
        </div>
        <Banners />
        <MapControls />
        <Toast />
      </div>
    );
  }

  return (
    <div className={`app mobile ${searchOpen ? 'is-searching' : ''} sheet-${snap}`}>
      <MapView />
      <div className="mobile-top">
        {!searchOpen && (
          <header className="top-bar">
            <Brand />
            <StatusPill />
          </header>
        )}
        {tab === 'map' && <SearchPanel compactable />}
        <GeoStatusChip />
        <Banners />
      </div>
      {!searchOpen && (
        <BottomSheet snap={snap} onSnap={(s) => setState({ sheetSnap: s })} label="Details panel" resetKey={tab}>
          <div className="sheet-controls">
            <MapControls />
          </div>
          <TabContent />
        </BottomSheet>
      )}
      {!searchOpen && <TabBar variant="bottom" />}
      <Toast />
    </div>
  );
}
