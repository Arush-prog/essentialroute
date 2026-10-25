/**
 * Device compass heading (degrees clockwise from true-ish north), like Google Maps' blue arrow.
 *
 * - Android Chrome: `deviceorientationabsolute` (alpha is relative to north).
 * - iPhone Safari: `webkitCompassHeading`, after the user grants motion access (needs a tap).
 * - Corrected for screen rotation (landscape).
 * - Smoothed on the unit circle so the arrow turns fluidly without jitter or 359°→0° jumps.
 * Only the heading number is kept in memory; nothing is stored or sent anywhere.
 */

let started = false;
let raw: number | null = null;
let lastEventAt = 0;

const norm = (d: number) => ((d % 360) + 360) % 360;

function screenAngle() {
  const so = (screen as Screen & { orientation?: { angle?: number } }).orientation;
  if (so && typeof so.angle === 'number') return so.angle;
  const wo = (window as unknown as { orientation?: number }).orientation;
  return typeof wo === 'number' ? wo : 0;
}

/**
 * Tilt-compensated heading from the full device orientation (rotation matrix per the W3C
 * DeviceOrientation spec). Plain `360 - alpha` is only right when the phone lies flat; held upright
 * — how people walk with it — it swings wildly. We combine the horizontal direction of the phone's
 * top edge (dominant when flat) with the direction its back faces (dominant when upright), so the
 * arrow is stable at every tilt.
 */
function headingFrom(alpha: number, beta: number | null, gamma: number | null): number {
  if (beta == null || gamma == null) return norm(360 - alpha);
  const r = Math.PI / 180;
  const cX = Math.cos(beta * r), sX = Math.sin(beta * r);
  const cY = Math.cos(gamma * r), sY = Math.sin(gamma * r);
  const cZ = Math.cos(alpha * r), sZ = Math.sin(alpha * r);
  // device top edge (y axis) projected on the ground: east, north
  const tE = -cX * sZ;
  const tN = cZ * cX;
  // direction the back of the phone faces (−z axis) projected on the ground
  const bE = -cY * sZ * sX - cZ * sY;
  const bN = -sZ * sY + cZ * cY * sX;
  const e = tE + bE;
  const n = tN + bN;
  if (Math.abs(e) < 1e-6 && Math.abs(n) < 1e-6) return norm(360 - alpha);
  return norm((Math.atan2(e, n) * 180) / Math.PI);
}

// Latest sensor reading; smoothing runs on the animation clock (see compassHeading), so the arrow
// settles on the true direction even on phones that only send events when the reading changes.
let meas: number | null = null;
let sx = 0;
let cx = 0;
let lastStep = 0;
function sample(h: number) {
  meas = h;
  lastEventAt = Date.now();
}

let gotAbsolute = false;
function onAbsolute(e: DeviceOrientationEvent) {
  if (e.alpha == null) return;
  gotAbsolute = true;
  sample(norm(headingFrom(e.alpha, e.beta, e.gamma) + screenAngle()));
}

function onRelative(e: DeviceOrientationEvent) {
  const ios = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
  if (typeof ios === 'number' && !Number.isNaN(ios)) sample(norm(ios + screenAngle()));
  else if (!gotAbsolute && e.absolute && e.alpha != null) sample(norm(headingFrom(e.alpha, e.beta, e.gamma) + screenAngle()));
}

/** Start listening. Call from a tap (iPhone requires it for permission). Safe to call repeatedly. */
export async function startCompass(): Promise<boolean> {
  if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return false;
  if (started) return true;
  const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> };
  started = true;
  // iPhone needs explicit permission (asked from the user's tap). Newer Chrome also exposes this call
  // but answers "prompt" — only an explicit "denied" means no compass.
  if (typeof DOE.requestPermission === 'function') {
    try {
      if ((await DOE.requestPermission()) === 'denied') {
        started = false;
        return false;
      }
    } catch {
      /* called outside a tap on iPhone — listeners below simply receive nothing */
    }
  }
  if (!started) return false;
  if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onAbsolute as EventListener, true);
  window.addEventListener('deviceorientation', onRelative, true);
  return true;
}

export function stopCompass() {
  if (!started) return;
  started = false;
  window.removeEventListener('deviceorientationabsolute', onAbsolute as EventListener, true);
  window.removeEventListener('deviceorientation', onRelative, true);
  raw = null;
  meas = null;
  gotAbsolute = false;
}

/** Latest smoothed heading, or null if no compass reading in the last 3 s (laptop, no sensor, denied). */
export function compassHeading(): number | null {
  if (meas == null || Date.now() - lastEventAt > 3000) return null;
  const now = performance.now();
  const r = (meas * Math.PI) / 180;
  if (raw == null) {
    sx = Math.sin(r);
    cx = Math.cos(r);
  } else {
    // vector average (sin/cos): immune to the 359°→0° wrap; ~120 ms time constant filters sensor noise
    const k = 1 - Math.exp(-Math.min(200, now - lastStep) / 120);
    sx += (Math.sin(r) - sx) * k;
    cx += (Math.cos(r) - cx) * k;
  }
  lastStep = now;
  raw = norm((Math.atan2(sx, cx) * 180) / Math.PI);
  return raw;
}
