/** Minimal inline icon set (stroke icons, 24×24). */
const paths: Record<string, string> = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4.2-4.2',
  locate: 'M12 2v3m0 14v3M2 12h3m14 0h3M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  nav: 'M3 11 21 3l-8 18-2-8z',
  swap: 'M7 4v15m0 0-3-3m3 3 3-3M17 20V5m0 0-3 3m3-3 3 3',
  close: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  layers: 'M12 3 2 8l10 5 10-5zM2 13l10 5 10-5',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14m6-12v14',
  compass: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm3.5 5.5-2 5-5 2 2-5z',
  flood: 'M3 17c2 0 2-1.5 4.5-1.5S9.5 17 12 17s2.5-1.5 4.5-1.5S19 17 21 17M3 21c2 0 2-1.5 4.5-1.5S9.5 21 12 21s2.5-1.5 4.5-1.5S19 21 21 21M12 3s-5 5.5-5 8.5a5 5 0 0 0 10 0C17 8.5 12 3 12 3z',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4zm4 4h4',
  car: 'M5 16v3m14-3v3M4 16h16v-4l-2-5H6l-2 5zm3-1.5h.01M17 14.5h.01',
  walk: 'M13 4.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM9 22l2-6 3 3v5m-6-12 3-3 3 2 2 3h3M11 7 9 13',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4v5l3 2',
  back: 'M15 5l-7 7 7 7',
  volume: 'M4 9v6h4l5 4V5L8 9zm12.5-.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  mute: 'M4 9v6h4l5 4V5L8 9zm12 0 5 6m0-6-5 6',
  rain: 'M7 15a4 4 0 0 1-.6-8A6 6 0 0 1 18 8a3.5 3.5 0 0 1-.5 7zM8 18l-1 3m5-3-1 3m5-3-1 3',
  start: 'M12 2 5 20l7-4 7 4z',
  chevron: 'M9 6l6 6-6 6',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 8v5m0-8.5v.01',
  warn: 'M12 3 2 20h20zm0 6v5m0 3v.01',
  trash: 'M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13',
  refresh: 'M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15m0 5v-5h5',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  pin: 'M12 21s7-6.3 7-12a7 7 0 1 0-14 0c0 5.7 7 12 7 12zm0-9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  route: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm12-10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 15V9a4 4 0 0 1 4-4h2m6 4v6a4 4 0 0 1-4 4h-2',
  shield: 'M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z',
  sidebar: 'M4 5h16v14H4zM9 5v14',
  check: 'M5 12l5 5L19 7',
  hist: 'M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5m4-1v5l3 2',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  play: 'M7 4v16l13-8z',
  external: 'M14 4h6v6m0-6-9 9M18 14v6H4V6h6',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  send: 'M4 12 20 4l-6 16-3-7z',
};

export function Icon({ name, size = 20, className = '', title }: { name: keyof typeof paths | string; size?: number; className?: string; title?: string }) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      <path d={paths[name] ?? paths.info} />
    </svg>
  );
}
