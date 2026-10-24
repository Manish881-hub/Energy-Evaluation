export default function Logo({ size = 38 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label="Windline">
      <defs>
        <linearGradient id="windline-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0f766e" />
          <stop offset="1" stopColor="#0b4f6c" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill="url(#windline-mark)" />
      <g fill="none" stroke="#ecfeff" strokeWidth="2.1" strokeLinecap="round">
        <path d="M20 17.5V33" />
        <path d="M20 14.5L20 5.5" />
        <path d="M20 14.5L28.5 19.8" />
        <path d="M20 14.5L11.5 19.8" />
        <circle cx="20" cy="14.5" r="2.2" fill="#ecfeff" stroke="none" />
        <path d="M15 33h10" />
      </g>
    </svg>
  );
}
