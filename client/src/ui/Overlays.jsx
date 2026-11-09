import { useProgress } from '@react-three/drei'
import { useEffect, useState } from 'react'

import { PETS, RARITIES, rebirthMultiplier } from '@shared/balance'
import { mult } from '@shared/format'

import { sfx } from '../game/audio'
import { useUi } from '../game/stores/ui'
import { GRADIENTS, u } from './hud/style'
import Icon from './Icon'
import { BottleIcon, PetFace } from './icons'
import StrokeText from './StrokeText'

const HATCH_SHAKE_MS = 1250

/** The egg shakes and bursts, then the pet pops out over spinning rays. Tap to dismiss. */
export function HatchOverlay() {
  const hatching = useUi((s) => s.hatching)
  if (!hatching) return null
  // Keyed per hatch, so every hatch starts from the shake.
  return <HatchScene key={hatching.at} hatching={hatching} />
}

function HatchScene({ hatching }) {
  const [revealed, setRevealed] = useState(false)

  const def = PETS[hatching.pets[0].id]
  const rarity = RARITIES[def.rarity]
  const rank = Math.max(0, Object.keys(RARITIES).indexOf(def.rarity))

  useEffect(() => {
    // Sounds in step with the shake: two cracks as the shell splits, then the reveal.
    const timers = [
      setTimeout(() => sfx.crack(1), HATCH_SHAKE_MS * 0.45),
      setTimeout(() => sfx.crack(2), HATCH_SHAKE_MS * 0.7),
      setTimeout(() => {
        setRevealed(true)
        sfx.reveal(rank)
      }, HATCH_SHAKE_MS),
      setTimeout(() => useUi.setState({ hatching: null }), HATCH_SHAKE_MS + 2600),
    ]
    return () => timers.forEach(clearTimeout)
  }, [rank])

  return (
    <div
      className="pp-font pointer-events-auto absolute inset-0 z-40 grid place-items-center"
      style={{ background: 'radial-gradient(circle at 50% 45%, rgba(20,16,40,0.35) 0%, rgba(6,8,16,0.78) 75%)' }}
      onPointerDown={() => revealed && useUi.setState({ hatching: null })}
    >
      {!revealed ? (
        <div className="pp-egg relative">
          <Icon name={`egg:${hatching.egg || 'sprout'}`} size={u(360)} />
          {/* Cracks spread across the shell as it shakes harder. */}
          <svg className="egg-crack absolute inset-0 h-full w-full" viewBox="0 0 100 100" aria-hidden="true">
            <path d="M22 50 L32 44 L38 53 L47 43 L54 54 L62 45 L69 53 L78 47" fill="none" stroke="#1d1f26" strokeWidth="3.2" strokeLinejoin="round" strokeLinecap="round" />
            <path d="M47 43 L45 34 M62 45 L66 37 M38 53 L36 61" fill="none" stroke="#1d1f26" strokeWidth="2.4" strokeLinecap="round" className="egg-crack-late" />
          </svg>
        </div>
      ) : (
        <div className="relative flex flex-col items-center">
          {/* The shell bursts: a white flash, then the pet over its rarity's rays. */}
          <div className="anim-flash pointer-events-none fixed inset-0 bg-white" />
          <div
            className="pp-rays absolute"
            style={{ width: u(900), height: u(900), top: u(-300), background: `repeating-conic-gradient(from 0deg, ${rarity.color}88 0deg 9deg, transparent 9deg 24deg)` }}
          />
          <div className="anim-pop relative">
            <PetFace size={u(320)} body={def.body} ear={def.ear} ears={def.ears} />
          </div>
          <span className="relative" style={{ fontSize: u(80) }}>
            <StrokeText stroke={u(14)} fill={rarity.color}>
              {rarity.name}!
            </StrokeText>
          </span>
          <span className="relative" style={{ fontSize: u(70) }}>
            <StrokeText stroke={u(13)}>{def.name}</StrokeText>
          </span>
          <span className="relative" style={{ fontSize: u(52) }}>
            <StrokeText stroke={u(10)} gradient={GRADIENTS.greenButton}>
              {mult(def.mult)} Power
            </StrokeText>
          </span>
          <span className="relative" style={{ fontSize: u(30), marginTop: u(16) }}>
            <StrokeText stroke={u(6)} fill="#c8d0dc">
              Tap to continue
            </StrokeText>
          </span>
        </div>
      )}
    </div>
  )
}

const CONFETTI = Array.from({ length: 36 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: ((i * 13) % 10) / 20,
  color: ['#ffd23f', '#ff5fa8', '#3ee0ff', '#8cff6b', '#c084fc'][i % 5],
  size: 8 + ((i * 7) % 8),
}))

/** Rebirth! A white flash, the rebirth icon, the new multiplier and CSS confetti. */
export function RebirthCelebration() {
  const celebrate = useUi((s) => s.celebrate)
  const [doneId, setDoneId] = useState(null)
  useEffect(() => {
    if (!celebrate) return undefined
    const t = setTimeout(() => setDoneId(celebrate.id), 2400)
    return () => clearTimeout(t)
  }, [celebrate])
  if (!celebrate || doneId === celebrate.id) return null
  return (
    <div key={celebrate.id} className="pp-font pointer-events-none absolute inset-0 z-40 overflow-hidden">
      <div className="anim-flash absolute inset-0 bg-white" />
      {CONFETTI.map((c, i) => (
        <span
          key={i}
          className="anim-confetti absolute top-[-20px] rounded-sm"
          style={{ left: `${c.left}%`, width: c.size, height: c.size * 0.6, background: c.color, animationDelay: `${c.delay}s` }}
        />
      ))}
      <div className="absolute inset-0 grid place-items-center">
        <div className="anim-levelup flex flex-col items-center">
          <Icon name="rebirth" size={u(220)} className="pp-bounce" />
          <span style={{ fontSize: u(120) }}>
            <StrokeText stroke={u(20)} gradient={GRADIENTS.purpleButton}>
              REBIRTH!
            </StrokeText>
          </span>
          <span style={{ fontSize: u(52) }}>
            <StrokeText stroke={u(10)}>
              Rebirth {celebrate.rebirths} · {mult(rebirthMultiplier(celebrate.rebirths))} Power forever
            </StrokeText>
          </span>
          {celebrate.gift && (
            <span style={{ fontSize: u(42) }}>
              <StrokeText stroke={u(8)} gradient={GRADIENTS.gold}>
                Gift: {celebrate.gift.label}!
              </StrokeText>
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

/** Shown until the lobby has been drawn. */
export function LoadingScreen() {
  const loaded = useUi((s) => s.loaded)
  const { progress, active } = useProgress()
  const [gone, setGone] = useState(false)

  useEffect(() => {
    if (!loaded) return undefined
    const t = setTimeout(() => setGone(true), 450)
    return () => clearTimeout(t)
  }, [loaded])

  if (gone) return null
  const pctDone = loaded ? 100 : active ? Math.max(8, Math.round(progress)) : 60
  return (
    <div
      className={`pp-font absolute inset-0 z-50 grid place-items-center transition-opacity duration-500 ${loaded ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
      style={{ background: 'radial-gradient(circle at 50% 40%, #6fd0ff 0%, #2a8af5 45%, #4b2bb8 100%)' }}
    >
      <div className="flex flex-col items-center px-6 text-center">
        <div className="pp-bounce">
          <BottleIcon size={u(220)} fill="#ff6fb5" glass="#f5f0ff" cap="#ffd23f" />
        </div>
        <span style={{ fontSize: u(130), marginTop: u(10) }}>
          <StrokeText stroke={u(22)} gradient={GRADIENTS.gold}>
            Bottle Tumble
          </StrokeText>
        </span>
        <span style={{ fontSize: u(44) }}>
          <StrokeText stroke={u(9)}>Toss it. Tumble it. Smash it.</StrokeText>
        </span>
        <div
          className="relative overflow-hidden"
          style={{ width: u(620), height: u(54), marginTop: u(36), borderRadius: u(27), border: `${u(6)} solid #111`, background: 'rgba(20,24,32,0.7)', boxShadow: `0 ${u(5)} 0 #111` }}
        >
          <div className="absolute inset-y-0 left-0 transition-[width] duration-300" style={{ width: `${pctDone}%`, background: 'linear-gradient(180deg, #c6ff7a 0%, #6fe04a 50%, #26ad3c 100%)' }} />
          <div className="absolute" style={{ left: u(10), right: u(10), top: u(4), height: u(10), borderRadius: u(5), background: 'rgba(255,255,255,0.3)' }} />
        </div>
        <span style={{ fontSize: u(34), marginTop: u(10) }}>
          <StrokeText stroke={u(7)}>Loading… {pctDone}%</StrokeText>
        </span>
      </div>
    </div>
  )
}

export function ContextLostOverlay() {
  const lost = useUi((s) => s.contextLost)
  if (!lost) return null
  return (
    <div className="pp-font absolute inset-0 z-50 grid place-items-center bg-black/70">
      <div className="flex flex-col items-center">
        <span style={{ fontSize: u(64) }}>
          <StrokeText stroke={u(12)}>Graphics paused</StrokeText>
        </span>
        <span style={{ fontSize: u(34) }}>
          <StrokeText stroke={u(7)} fill="#c8d0dc">
            Recovering the 3D view… your progress is safe.
          </StrokeText>
        </span>
      </div>
    </div>
  )
}
