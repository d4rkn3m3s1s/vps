// VPS Fleet brand mark — a cloud-phone with an orbital signal arc + a fleet of
// satellite nodes, in the red-noir palette. Self-contained SVG (crisp at any
// size, no asset request). Use `size` to scale; it inherits the rounded gradient
// tile styling from `.brand-mark` when rendered there.
export function BrandLogo({ size = 38, title = 'VPS Fleet' }: { size?: number; title?: string }) {
  const gid = 'vpsfleet-grad';
  const gid2 = 'vpsfleet-glow';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label={title}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gid} x1="8" y1="6" x2="40" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ff4d5e" />
          <stop offset="0.55" stopColor="#ef233c" />
          <stop offset="1" stopColor="#d90429" />
        </linearGradient>
        <radialGradient id={gid2} cx="0.5" cy="0.42" r="0.6">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Rounded tile background */}
      <rect x="2" y="2" width="44" height="44" rx="13" fill={`url(#${gid})`} />
      <rect x="2" y="2" width="44" height="44" rx="13" fill={`url(#${gid2})`} />
      <rect x="2.6" y="2.6" width="42.8" height="42.8" rx="12.5" stroke="#ffffff" strokeOpacity="0.22" strokeWidth="1.2" />

      {/* Phone body (the device) */}
      <rect x="18" y="13" width="12" height="22" rx="3.2" fill="#ffffff" />
      <rect x="20" y="16.4" width="8" height="13.2" rx="1.2" fill="#d90429" fillOpacity="0.92" />
      {/* speaker + home dot */}
      <rect x="22" y="14.4" width="4" height="1" rx="0.5" fill="#d90429" fillOpacity="0.5" />
      <circle cx="24" cy="32.2" r="1.1" fill="#ffffff" />
      <circle cx="24" cy="32.2" r="1.1" fill="#d90429" fillOpacity="0.35" />

      {/* Orbital signal arc — the "fleet" sweeping around the device */}
      <path
        d="M11.5 30.5 A 14.5 14.5 0 0 1 11.5 17.5"
        stroke="#ffffff"
        strokeOpacity="0.85"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M36.5 17.5 A 14.5 14.5 0 0 1 36.5 30.5"
        stroke="#ffffff"
        strokeOpacity="0.55"
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* Satellite fleet nodes on the orbit */}
      <circle cx="11.5" cy="24" r="2.1" fill="#ffffff" />
      <circle cx="36.5" cy="24" r="1.6" fill="#ffffff" fillOpacity="0.8" />
      <circle cx="24" cy="9.5" r="1.5" fill="#ffffff" fillOpacity="0.7" />
    </svg>
  );
}
