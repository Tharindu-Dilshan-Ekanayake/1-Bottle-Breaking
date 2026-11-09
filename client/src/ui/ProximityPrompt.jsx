import { useEffect, useRef } from 'react'

import { BOTTLES, EGGS, WORLDS } from '@shared/balance'
import { fmt } from '@shared/format'
import { eggStandsFor, PEDESTALS, portalTarget, portalX, portalZ } from '@shared/world'

import { sfx } from '../game/audio'
import { registerPromptNode, setPromptTarget } from '../game/promptAnchor'
import { toast, useUi } from '../game/stores/ui'
import { actions } from '../net/actions'
import { useGame } from '../store/game'
import { buyOrEquipBottle, hatchEgg } from './actions'
import { useIsTouch } from './device'
import Icon from './Icon'
import { BottleIcon } from './icons'
import { Price } from './hud/parts'
import { GRADIENTS, u } from './hud/style'
import StrokeText from './StrokeText'

/*
 * The "press E" prompt that floats over the shop pedestal or egg stand you walk up to:
 * what it is, what E does there (Unlock / Equip / Hatch) and what it costs. The whole
 * prompt is a button too, so on a phone you tap it. PromptProjector (in the canvas)
 * keeps it over its pedestal every frame.
 */


/** What the prompt says for where you stand, or null for nothing. */
function usePromptTarget() {
  const mode = useUi((s) => s.mode)
  const panel = useUi((s) => s.panel)
  // The hatch has the screen to itself.
  const hatching = useUi((s) => s.hatching !== null)
  const nearby = useUi((s) => s.nearby)
  const pedestal = useUi((s) => s.pedestal)
  const owned = useGame((s) => s.profile.ownedBottles)
  const equipped = useGame((s) => s.profile.equippedBottle)
  const wins = useGame((s) => s.profile.wins - s.pendingWins)
  const world = useGame((s) => s.profile.world || 1)
  const worlds = useGame((s) => s.profile.worlds)
  const rebirths = useGame((s) => s.profile.rebirths)
  if (mode !== 'walk' || panel || hatching) return null

  if (nearby === 'shop' && pedestal >= 0) {
    const b = BOTTLES[pedestal]
    const p = PEDESTALS[pedestal]
    const has = owned.includes(b.id)
    const prev = BOTTLES[pedestal - 1]
    const isNext = !has && (!prev || owned.includes(prev.id))
    const base = { id: `b${pedestal}`, at: { x: p.x, y: 4.5, z: p.z }, bottle: b, title: b.name, sub: `+${fmt(b.power)} Power` }
    // The E key always shows: on a locked or equipped bottle it says why it won't.
    if (has && equipped === b.id) {
      return { ...base, verb: 'EQUIPPED', tone: 'done', act: () => toast(`${b.name} is already equipped`) }
    }
    if (has) return { ...base, verb: 'EQUIP', tone: 'go', act: () => buyOrEquipBottle(b.id) }
    if (!isNext) return { ...base, verb: 'LOCKED', tone: 'locked', sub: `Unlock the ${prev.name} first`, act: () => buyOrEquipBottle(b.id) }
    return { ...base, verb: 'UNLOCK', tone: wins >= b.cost ? 'buy' : 'short', price: b.cost, afford: wins >= b.cost, act: () => buyOrEquipBottle(b.id) }
  }

  if (nearby?.startsWith('egg:')) {
    const id = nearby.slice(4)
    const egg = EGGS[id]
    const stand = eggStandsFor(world).find((e) => e.egg === id)
    if (!egg || !stand) return null
    return {
      id: `e${id}`,
      at: { x: stand.x, y: 4.1, z: stand.z },
      egg: id,
      title: egg.name,
      sub: 'A random pet inside!',
      verb: 'HATCH',
      tone: wins >= egg.cost ? 'buy' : 'short',
      price: egg.cost,
      afford: wins >= egg.cost,
      act: () => hatchEgg(id),
    }
  }

  if (nearby === 'portal') {
    const to = portalTarget(world)
    const dest = WORLDS[to]
    const need = dest.unlock
    const base = { id: `p${to}`, at: { x: portalX(0, 0.3), y: 6.9, z: portalZ(0, 0.3) }, portal: to, title: `World ${to}: ${dest.name}`, act: () => actions.travel(to) }
    if (!need || worlds?.includes(to)) return { ...base, verb: 'TRAVEL', tone: 'go', sub: to === 1 ? 'Back to the first world' : `x${dest.gain} Power, x${dest.wins} Wins` }
    if (rebirths < need.rebirths) {
      return { ...base, verb: 'LOCKED', tone: 'locked', price: need.wins, afford: wins >= need.wins, sub: `Needs ${need.rebirths} Rebirths (you have ${rebirths})` }
    }
    return { ...base, verb: 'UNLOCK', tone: wins >= need.wins ? 'buy' : 'short', price: need.wins, afford: wins >= need.wins, sub: `x${dest.gain} Power, x${dest.wins} Wins` }
  }
  return null
}

const TONE = {
  buy: { border: '#ffd23f', verb: GRADIENTS.gold },
  short: { border: '#ff8a5c', verb: GRADIENTS.gold },
  go: { border: '#7dff4a', verb: GRADIENTS.greenButton },
  done: { border: '#7dff4a', verb: GRADIENTS.greenButton },
  locked: { border: '#8b93a7', verb: null },
}

export function ProximityPrompt() {
  const target = usePromptTarget()
  // TAP on a touch screen (including one first touched mid-session), E elsewhere.
  const KEY = useIsTouch() ? 'TAP' : 'E'
  const rootRef = useRef(null)
  const keyRef = useRef(null)

  useEffect(() => {
    registerPromptNode(rootRef.current)
    return () => registerPromptNode(null)
  }, [])

  // Float over the new target (or hide). Only when the target changes.
  const anchorKey = target ? `${target.id}` : ''
  useEffect(() => {
    setPromptTarget(target ? target.at : null)
    // A glass clink at a shop bottle, a soft pop at an egg.
    if (target?.bottle) sfx.clink()
    else if (target) sfx.prompt()
    // `target.at` is fixed per id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey])
  useEffect(() => () => setPromptTarget(null), [])

  // The key cap dips when E is pressed (the action itself is the HUD's E handler).
  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== 'KeyE' || e.repeat || !keyRef.current) return
      const el = keyRef.current
      el.classList.remove('prompt-key-press')
      void el.offsetWidth
      el.classList.add('prompt-key-press')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const tone = target ? TONE[target.tone] : TONE.locked
  return (
    <div ref={rootRef} className="pp-font pointer-events-none absolute left-0 top-0 z-[6]" style={{ opacity: 0, transition: 'opacity 120ms' }}>
      {target && (
        <button
          key={target.id}
          type="button"
          className="prompt-card anim-pop pointer-events-auto flex items-center"
          onClick={target.act}
          disabled={!target.act}
          title={target.act ? `${target.verb} ${target.title}` : target.title}
          style={{ gap: u(14), padding: `${u(12)} ${u(20)} ${u(12)} ${u(14)}`, borderRadius: u(22), border: `${u(5)} solid ${tone.border}` }}
        >
          {target.act ? (
            <span ref={keyRef} className="prompt-key grid shrink-0 place-items-center" style={{ minWidth: u(64), height: u(64), borderRadius: u(14), fontSize: u(KEY.length > 1 ? 26 : 38) }}>
              {KEY}
            </span>
          ) : (
            <span className="grid shrink-0 place-items-center" style={{ width: u(64), height: u(64) }}>
              <Icon name={target.tone === 'done' ? 'check' : 'close'} size={u(48)} />
            </span>
          )}
          <span className="grid shrink-0 place-items-center" style={{ width: u(64), height: u(76) }}>
            {target.bottle ? (
              <BottleIcon size={u(72)} fill={target.bottle.fill} glass={target.bottle.glass} cap={target.bottle.cap} />
            ) : target.portal ? (
              <Icon name="portal" size={u(70)} />
            ) : (
              <Icon name={`egg:${target.egg}`} size={u(70)} />
            )}
          </span>
          <span className="flex flex-col items-start" style={{ lineHeight: 1.05 }}>
            <span className="flex items-center" style={{ gap: u(14) }}>
              <span style={{ fontSize: u(44) }}>
                <StrokeText stroke={u(9)} gradient={tone.verb || undefined} fill="#c8d0dc">
                  {target.verb}
                </StrokeText>
              </span>
              {target.price != null && <Price amount={target.price} size={36} afford={target.afford} />}
            </span>
            <span style={{ fontSize: u(30) }}>
              <StrokeText stroke={u(6)} fill={target.bottle ? target.bottle.fill : target.portal ? (target.portal === 2 ? '#f9a8d4' : '#86efac') : EGGS[target.egg].color}>
                {target.title}
              </StrokeText>
            </span>
            <span style={{ fontSize: u(22) }}>
              <StrokeText stroke={u(5)} fill="#c8d0dc">
                {target.tone === 'short' ? `Need ${fmt(target.price)} Wins` : target.sub}
              </StrokeText>
            </span>
          </span>
        </button>
      )}
    </div>
  )
}

export default ProximityPrompt
