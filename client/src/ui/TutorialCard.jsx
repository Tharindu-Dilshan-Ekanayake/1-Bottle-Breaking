import { useEffect, useRef } from 'react'

import { BOTTLES } from '@shared/balance'
import { fmt } from '@shared/format'

import { sfx } from '../game/audio'
import { toast } from '../game/stores/ui'
import { TRAIN_GOAL, TUTORIAL_STEPS, tutorialStep } from '../game/tutorial'
import { useGame } from '../store/game'
import { GRADIENTS, u } from './hud/style'
import Icon from './Icon'
import StrokeText from './StrokeText'

/*
 * The first-time guide's card (the arrows on the ground are TutorialArrows): which step
 * you're on and what to do. Three steps - train, throw, buy a bottle - then a cheer and
 * it's gone for good (it follows from the profile, so it never comes back).
 */

const STEPS = {
  1: { title: 'TRAINING', icon: 'muscle', text: 'Follow the arrows to a training pit and stand on it' },
  2: { title: 'THROW', icon: 'fastForward', text: 'Follow the arrows to the THROW ZONE and throw your bottle!' },
  3: { title: 'BOTTLES', icon: 'store', text: 'Follow the arrows to the shop and buy a new bottle' },
}

export function TutorialCard() {
  const step = useGame((s) => tutorialStep(s.profile))
  const trains = useGame((s) => s.profile.stats.trains)
  const wins = useGame((s) => s.profile.wins - s.pendingWins)
  const nextCost = useGame((s) => BOTTLES.find((b) => !s.profile.ownedBottles.includes(b.id))?.cost ?? 0)
  const last = useRef(step)

  // Finished during this session: a little celebration.
  useEffect(() => {
    if (last.current > 0 && step === 0) {
      sfx.unlock()
      toast('Guide complete - have fun!', 'good')
    }
    last.current = step
  }, [step])

  if (!step) return null
  const info = STEPS[step]
  const detail =
    step === 1
      ? `${Math.min(trains, TRAIN_GOAL)} / ${TRAIN_GOAL} reps`
      : step === 3 && wins < nextCost
        ? `Throw again for ${fmt(nextCost)} Wins`
        : null
  return (
    // Placed by index.css (.tut-card): top centre; on portrait screens to the right of the stats.
    <div className="tut-card pointer-events-none absolute flex">
      <div
        key={step}
        className="anim-pop flex items-center"
        style={{ gap: u(12), padding: `${u(8)} ${u(20)} ${u(10)} ${u(12)}`, borderRadius: u(20), maxWidth: '100%', background: 'linear-gradient(180deg, rgba(44,48,64,0.95), rgba(24,26,38,0.95))', border: `${u(5)} solid #ffd23f`, boxShadow: `0 ${u(6)} 0 #111` }}
      >
        <span className="grid shrink-0 place-items-center" style={{ width: u(60), height: u(60) }}>
          <Icon name={info.icon} size={u(56)} />
        </span>
        <span className="flex min-w-0 flex-col" style={{ lineHeight: 1.1 }}>
          <span className="flex items-center" style={{ gap: u(12) }}>
            <span style={{ fontSize: u(22) }}>
              <StrokeText stroke={u(5)} fill="#c8d0dc">
                STEP {step} OF {TUTORIAL_STEPS}
              </StrokeText>
            </span>
            <span style={{ fontSize: u(32) }}>
              <StrokeText stroke={u(7)} gradient={GRADIENTS.gold}>
                {info.title}
              </StrokeText>
            </span>
          </span>
          <span style={{ fontSize: u(22) }}>
            <StrokeText stroke={u(5)} style={{ whiteSpace: 'normal' }}>
              {info.text}
            </StrokeText>
          </span>
          {detail && (
            <span style={{ fontSize: u(21) }}>
              <StrokeText stroke={u(5)} fill="#7dff4a">
                {detail}
              </StrokeText>
            </span>
          )}
        </span>
      </div>
    </div>
  )
}

export default TutorialCard
