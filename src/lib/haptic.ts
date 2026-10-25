/** Short vibration on supported devices (Android). No-op on iOS/desktop or with reduced motion. */
export function haptic(ms = 10) {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    navigator.vibrate?.(ms);
  } catch {
    /* unsupported */
  }
}
