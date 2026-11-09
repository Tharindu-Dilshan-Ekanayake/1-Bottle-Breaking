import { useId } from 'react'

/* Inline SVG icons with gradients and highlights - no icon font or image requests. */

const INK = '#1d1436'
const base = (size) => ({ style: { width: size, height: size }, viewBox: '0 0 32 32', 'aria-hidden': true })

/** A vertical gradient def, with a unique id per icon instance. */
function useGrad(top, bottom) {
  const id = useId().replace(/:/g, '')
  return [
    `url(#${id})`,
    <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor={top} />
      <stop offset="1" stopColor={bottom} />
    </linearGradient>,
  ]
}

export function BoltIcon({ size = 22 }) {
  const [fill, def] = useGrad('#fff3a3', '#ffb800')
  return (
    <svg {...base(size)}>
      <defs>{def}</defs>
      <path d="M18 2 6 18h8l-3 12 15-18h-8.5L18 2Z" fill={fill} stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M15.5 6.5 10 14.5" stroke="#fff" strokeOpacity=".8" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function TrophyIcon({ size = 22 }) {
  const [fill, def] = useGrad('#ffe57a', '#f59e0b')
  return (
    <svg {...base(size)}>
      <defs>{def}</defs>
      <path d="M9 5H5.5v2.5A5 5 0 0 0 10 12.4M23 5h3.5v2.5A5 5 0 0 1 22 12.4" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M9 3.5h14V10a7 7 0 0 1-14 0V3.5Z" fill={fill} stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M14 16.5h4v4h-4zM10 28.5h12v-3a3 3 0 0 0-3-3h-6a3 3 0 0 0-3 3v3Z" fill={fill} stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M12.5 6.5v4" stroke="#fff" strokeOpacity=".85" strokeWidth="2" strokeLinecap="round" />
      <path d="m16 6.6.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3.9-1.9Z" fill="#fff8d0" />
    </svg>
  )
}

export function RebirthIcon({ size = 22 }) {
  const [fill, def] = useGrad('#a5f3ff', '#0ea5e9')
  return (
    <svg {...base(size)}>
      <defs>{def}</defs>
      <path d="M26 16A10 10 0 1 1 22.6 8.5" fill="none" stroke={INK} strokeWidth="7.5" strokeLinecap="round" />
      <path d="M26 16A10 10 0 1 1 22.6 8.5" fill="none" stroke={fill} strokeWidth="4" strokeLinecap="round" />
      <path d="M27.5 3.5v8h-8l8-8Z" fill={fill} stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M11 11.5a7 7 0 0 1 4-2.2" stroke="#fff" strokeOpacity=".8" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export function BottleIcon({ size = 26, fill = '#3ee0ff', glass = '#e0f7ff', cap = '#ff5fa8' }) {
  const [liquid, def] = useGrad(fill, fill)
  return (
    <svg style={{ width: size, height: size }} viewBox="0 0 24 32" aria-hidden>
      <defs>{def}</defs>
      <rect x="8.6" y="1.5" width="6.8" height="3.6" rx="1.2" fill={cap} stroke={INK} strokeWidth="1.6" />
      <path d="M9.5 5h5v4l3.4 3.6V28a2.5 2.5 0 0 1-2.5 2.5H8.6A2.5 2.5 0 0 1 6.1 28V12.6L9.5 9V5Z" fill={glass} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M7.4 16.5h9.2v11a1.3 1.3 0 0 1-1.3 1.3H8.7a1.3 1.3 0 0 1-1.3-1.3v-11Z" fill={liquid} />
      <path d="M7.4 16.5h9.2v2.2H7.4z" fill="#fff" fillOpacity=".35" />
      <path d="M8.8 12.5v12.5" stroke="#fff" strokeOpacity=".8" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="13.6" cy="22" r="1" fill="#fff" fillOpacity=".7" />
      <circle cx="11.6" cy="25.5" r=".7" fill="#fff" fillOpacity=".6" />
    </svg>
  )
}

export function PawIcon({ size = 26 }) {
  const [fill, def] = useGrad('#ffd1ea', '#ff6fb5')
  return (
    <svg {...base(size)}>
      <defs>{def}</defs>
      <g fill={fill} stroke={INK} strokeWidth="2.2">
        <path d="M16 15c4.5 0 8 4.3 8 7.6 0 2.8-2.5 4.4-4.6 3.6-1.6-.6-2.3-1.2-3.4-1.2s-1.8.6-3.4 1.2C10.5 27 8 25.4 8 22.6 8 19.3 11.5 15 16 15Z" />
        <ellipse cx="7" cy="12.5" rx="2.8" ry="3.4" />
        <ellipse cx="12" cy="7.5" rx="2.8" ry="3.5" />
        <ellipse cx="20" cy="7.5" rx="2.8" ry="3.5" />
        <ellipse cx="25" cy="12.5" rx="2.8" ry="3.4" />
      </g>
      <path d="M12.5 19.5c.8-1.2 2-2 3.2-2.2" stroke="#fff" strokeOpacity=".85" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function GearIcon({ size = 22 }) {
  const [fill, def] = useGrad('#f1f5ff', '#94a3c8')
  return (
    <svg {...base(size)}>
      <defs>{def}</defs>
      <path
        d="M13.5 2.5h5l.8 3.4 2.3 1 3-1.8 3.5 3.5-1.8 3 1 2.3 3.4.8v5l-3.4.8-1 2.3 1.8 3-3.5 3.5-3-1.8-2.3 1-.8 3.4h-5l-.8-3.4-2.3-1-3 1.8-3.5-3.5 1.8-3-1-2.3-3.4-.8v-5l3.4-.8 1-2.3-1.8-3 3.5-3.5 3 1.8 2.3-1 .8-3.4Z"
        fill={fill}
        stroke={INK}
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="4.5" fill="#5b6b92" stroke={INK} strokeWidth="2.2" />
    </svg>
  )
}

export function LockIcon({ size = 16 }) {
  const [fill, def] = useGrad('#ffb4b4', '#ef4444')
  return (
    <svg {...base(size)}>
      <defs>{def}</defs>
      <path d="M10 14v-3.5a6 6 0 0 1 12 0V14" fill="none" stroke={INK} strokeWidth="3" />
      <rect x="6.5" y="13.5" width="19" height="15" rx="3.5" fill={fill} stroke={INK} strokeWidth="2.4" />
      <circle cx="16" cy="20.5" r="2.2" fill={INK} />
    </svg>
  )
}

export function CloseIcon({ size = 20 }) {
  return (
    <svg {...base(size)}>
      <path d="M8 8l16 16M24 8 8 24" stroke={INK} strokeWidth="7" strokeLinecap="round" />
      <path d="M8 8l16 16M24 8 8 24" stroke="white" strokeWidth="3.6" strokeLinecap="round" />
    </svg>
  )
}

export function StairsIcon({ size = 22 }) {
  const [fill, def] = useGrad('#c8ffb0', '#4ade80')
  return (
    <svg {...base(size)}>
      <defs>{def}</defs>
      <path d="M3 28v-6h6.5v-6H16v-6h6.5V4H29v24H3Z" fill={fill} stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
    </svg>
  )
}

export function EggIcon({ size = 26, color = '#86efac' }) {
  const [fill, def] = useGrad('#ffffff', color)
  return (
    <svg {...base(size)}>
      <defs>{def}</defs>
      <path d="M16 3c5.4 0 9.5 8.5 9.5 15.2A9.5 9.5 0 0 1 6.5 18.2C6.5 11.5 10.6 3 16 3Z" fill={fill} stroke={INK} strokeWidth="2.4" />
      <path d="m10 18 3-2.4 3 2.4 3-2.4 3 2.4" fill="none" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M11.5 9.5c.9-1.6 2-2.8 3.2-3.3" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

/** One icon per stage theme, for the throw's stage bar. */
export function ThemeIcon({ theme, size = 22 }) {
  const p = { ...base(size) }
  switch (theme) {
    case 'garden':
      return (
        <svg {...p}>
          <path d="M16 29V15" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
          <path d="M16 16C8 16 5 10 6 4c6 0 10 4 10 12Z" fill="#4ade80" stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M16 19c6.5 0 10-4.5 10-10-5.5 0-10 3.5-10 10Z" fill="#86efac" stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
        </svg>
      )
    case 'shore':
      return (
        <svg {...p}>
          <circle cx="23" cy="8" r="4.5" fill="#fde047" stroke={INK} strokeWidth="2" />
          <path d="M3 22c3-2.5 6-2.5 9 0s6 2.5 9 0 6-2.5 8 0v7H3v-7Z" fill="#38bdf8" stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M3 27h26" stroke="#f4d98e" strokeWidth="3" />
        </svg>
      )
    case 'snow':
      return (
        <svg {...p}>
          <g stroke={INK} strokeWidth="5" strokeLinecap="round">
            <path d="M16 3v26M4.7 9.5l22.6 13M4.7 22.5l22.6-13" />
          </g>
          <g stroke="#e0f2fe" strokeWidth="2.4" strokeLinecap="round">
            <path d="M16 3v26M4.7 9.5l22.6 13M4.7 22.5l22.6-13" />
          </g>
        </svg>
      )
    case 'crystal':
      return (
        <svg {...p}>
          <path d="M16 3 26 12 16 29 6 12 16 3Z" fill="#a78bfa" stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M6 12h20M16 3l-4 9 4 17 4-17-4-9" fill="none" stroke={INK} strokeWidth="1.4" />
          <path d="M11 9.5 13 7" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      )
    case 'neon':
      return (
        <svg {...p}>
          <rect x="3" y="3" width="26" height="26" rx="6" fill="#2a2342" stroke={INK} strokeWidth="2" />
          <path d="M18 6 10 17h6l-2 9 8-11h-6l2-9Z" fill="#f472b6" stroke="#ffd6ea" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      )
    case 'cloud':
      return (
        <svg {...p}>
          <path d="M9 25a6 6 0 0 1-.5-12A8 8 0 0 1 24 12a6.5 6.5 0 0 1 .5 13H9Z" fill="#ffffff" stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
          <path d="M11 17a4 4 0 0 1 3.5-3.4" stroke="#c7d2fe" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )
    default:
      return (
        <svg {...p}>
          <circle cx="16" cy="16" r="13" fill="#312e81" stroke={INK} strokeWidth="2" />
          <path d="m16 7 2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6-4.5-4.1 6-.7L16 7Z" fill="#fde047" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      )
  }
}

/** A front-on pet face in the pet's colours. */
export function PetFace({ size = 48, body = '#d6a46b', ear = '#8b5a2b', ears = 'point' }) {
  return (
    <svg style={{ width: size, height: size }} viewBox="0 0 48 48" aria-hidden>
      {ears === 'point' && (
        <g fill={ear} stroke={INK} strokeWidth="2">
          <path d="M10 18 13 6l8 9Z" />
          <path d="M38 18 35 6l-8 9Z" />
        </g>
      )}
      {ears === 'tall' && (
        <g fill={ear} stroke={INK} strokeWidth="2">
          <rect x="13" y="1" width="6" height="16" rx="3" />
          <rect x="29" y="1" width="6" height="16" rx="3" />
        </g>
      )}
      {ears === 'flop' && (
        <g fill={ear} stroke={INK} strokeWidth="2">
          <rect x="4" y="14" width="8" height="16" rx="3" />
          <rect x="36" y="14" width="8" height="16" rx="3" />
        </g>
      )}
      <rect x="8" y="12" width="32" height="30" rx="7" fill={body} stroke={INK} strokeWidth="2.4" />
      <rect x="11" y="15" width="10" height="4" rx="2" fill="#fff" fillOpacity=".45" />
      <rect x="16" y="23" width="4" height="6" rx="1.5" fill={INK} />
      <rect x="28" y="23" width="4" height="6" rx="1.5" fill={INK} />
      <circle cx="17.5" cy="24.5" r="1" fill="#fff" />
      <circle cx="29.5" cy="24.5" r="1" fill="#fff" />
      <ellipse cx="13" cy="31" rx="2.6" ry="1.6" fill="#ff8fb8" fillOpacity=".7" />
      <ellipse cx="35" cy="31" rx="2.6" ry="1.6" fill="#ff8fb8" fillOpacity=".7" />
      <path d="M21 33q3 2.5 6 0" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/** Boxity Gems. */
export function GemIcon({ size = 22 }) {
  const [fill, def] = useGrad('#a5f3fc', '#6d28d9')
  return (
    <svg {...base(size)}>
      <defs>{def}</defs>
      <path d="M9 4.5h14l5.5 7L16 28 3.5 11.5 9 4.5Z" fill={fill} stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M3.8 11.5h24.4M12 4.8l-2.6 6.7L16 27.4l6.6-15.9L20 4.8" fill="none" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" opacity=".55" />
      <path d="M10.5 7.5 8.6 10" stroke="#fff" strokeOpacity=".9" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

/** Friends (two heads). */
export function FriendsIcon({ size = 22 }) {
  const [fill, def] = useGrad('#fde68a', '#f97316')
  return (
    <svg {...base(size)}>
      <defs>{def}</defs>
      <circle cx="20.5" cy="10.5" r="4.6" fill={fill} stroke={INK} strokeWidth="2.4" />
      <path d="M13.5 26.5a7 7 0 0 1 14 0v1h-14v-1Z" fill={fill} stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
      <circle cx="11" cy="12.5" r="4.6" fill="#a5f3fc" stroke={INK} strokeWidth="2.4" />
      <path d="M4 28.5a7 7 0 0 1 14 0v.5H4v-.5Z" fill="#a5f3fc" stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
    </svg>
  )
}

/** "Watch an ad": a play button on a screen. */
export function AdIcon({ size = 22 }) {
  const [fill, def] = useGrad('#bbf7d0', '#16a34a')
  return (
    <svg {...base(size)}>
      <defs>{def}</defs>
      <rect x="3" y="6" width="26" height="19" rx="4" fill={fill} stroke={INK} strokeWidth="2.4" />
      <path d="M13.5 11v9l7.5-4.5-7.5-4.5Z" fill="#fff" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}
