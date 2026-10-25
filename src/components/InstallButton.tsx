import { useEffect, useState } from 'react';
import { Icon } from './Icon';

/**
 * "Install app" for Android Chrome: captures the browser's install prompt and offers it as a button,
 * so the app can be added to the home screen and opens full-screen like a native app.
 * Hidden when already installed or when the browser doesn't offer installation.
 */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const subs = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    subs.forEach((f) => f());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    subs.forEach((f) => f());
  });
}

const standalone = () => typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);

export function InstallButton() {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  }, []);
  if (!deferred || standalone()) return null;
  return (
    <button
      type="button"
      className="install-btn"
      onClick={async () => {
        const ev = deferred;
        if (!ev) return;
        await ev.prompt();
        await ev.userChoice.catch(() => undefined);
        deferred = null;
        force((n) => n + 1);
      }}
    >
      <Icon name="plus" size={18} />
      <span>
        <strong>Install EssentialRoute</strong>
        <span className="small muted"> · opens full-screen from your home screen</span>
      </span>
    </button>
  );
}
