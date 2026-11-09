import { useEffect, useRef, useState } from 'react'

import {
  BOTTLES,
  EGG_ORDER,
  WORLD_EGGS,
  EGGS,
  levelCap,
  MAX_PET_INVENTORY,
  nextRebirthGift,
  PADS,
  PETS,
  RARITIES,
  rebirthMultiplier,
} from '@shared/balance'
import { fmt, mult } from '@shared/format'
import { eggOdds, isMaxLevel, maxEquippedPets, petMultiplier, petSortKey, rebirthProgress, rebirthSkipPrice } from '@shared/logic'

import { sfx } from '../game/audio'
import { PRESETS, useQuality } from '../game/stores/quality'
import { toast, useUi } from '../game/stores/ui'
import { actions } from '../net/actions'
import { useGame } from '../store/game'
import { saveGraphicsSetting } from '../bloxity/integration'
import { getSDK } from '../bloxity/sdk'
import { buyOrEquipBottle, doRebirth, doSkipRebirth } from './actions'
import { FriendsPanel } from './BoxityPanels'
import { DailyPanel, GiftsPanel, UpgradesPanel } from './ProgressPanels'
import Icon from './Icon'
import { BottleIcon, PetFace } from './icons'
import { ChunkyButton, Price } from './hud/parts'
import { GRADIENTS, u } from './hud/style'
import Panel from './panels/Panel'
import StrokeText from './StrokeText'

/* All panels use the +1 Kick Field Goal kit: Panel frame, ChunkyButton, StrokeText. */

const CARD = (extra = {}) => ({
  borderRadius: u(18),
  border: `${u(5)} solid #111`,
  background: 'linear-gradient(180deg, #3a3f4c 0%, #262a33 100%)',
  boxShadow: `inset 0 ${u(4)} 0 rgba(255,255,255,0.12), 0 ${u(5)} 0 #111`,
  ...extra,
})

/* ---------------------------------------------------------------- Bottles */

/**
 * The Bottle Shop: every bottle on a card with its glow - green for the one you hold,
 * gold for the next to buy, dim for the ones further on. Buy works from anywhere.
 */
function BottleShop() {
  const owned = useGame((s) => s.profile.ownedBottles)
  const equipped = useGame((s) => s.profile.equippedBottle)
  const wins = useGame((s) => s.profile.wins - s.pendingWins)
  return (
    <Panel title="Bottle Shop" iconNode={<BottleIcon size={u(110)} fill="#ff6fb5" glass="#fbf5ff" cap="#ffd23f" />} width={1180}>
      <div className="grid grid-cols-2 sm:grid-cols-4" style={{ gap: u(22) }}>
        {BOTTLES.map((b, i) => {
          const has = owned.includes(b.id)
          const isOn = equipped === b.id
          const next = !has && (i === 0 || owned.includes(BOTTLES[i - 1].id))
          const afford = wins >= b.cost
          const aura = isOn ? '#7dff4a' : next ? '#ffd21f' : has ? b.fill : '#556070'
          return (
            <div
              key={b.id}
              className="relative flex flex-col items-center text-center"
              style={CARD({
                padding: `${u(14)} ${u(12)} ${u(16)}`,
                background: isOn
                  ? 'linear-gradient(180deg, #2f6b33 0%, #1d3f22 100%)'
                  : next
                    ? 'linear-gradient(180deg, #6b5a1f 0%, #3d3213 100%)'
                    : CARD().background,
                opacity: !has && !next ? 0.7 : 1,
              })}
            >
              <div className="relative grid place-items-center" style={{ width: u(150), height: u(150) }}>
                <div className="aura" style={{ '--aura': aura }} />
                <span className={isOn ? 'pp-bounce' : ''} style={{ filter: !has && !next ? 'grayscale(0.7) brightness(0.7)' : 'none' }}>
                  <BottleIcon size={u(120)} fill={b.fill} glass={b.glass} cap={b.cap} />
                </span>
              </div>
              <span style={{ fontSize: u(34), lineHeight: 1.1 }}>
                <StrokeText stroke={u(7)}>{b.name}</StrokeText>
              </span>
              <span className="flex items-center" style={{ gap: u(4), fontSize: u(28), marginTop: u(4) }}>
                <Icon name="muscle" size={u(36)} />
                <StrokeText stroke={u(6)} gradient={GRADIENTS.gold}>
                  {fmt(b.power)} Power
                </StrokeText>
              </span>
              <ChunkyButton
                gradient={isOn ? GRADIENTS.greyButton : has ? GRADIENTS.greenButton : next && afford ? GRADIENTS.goldButton : GRADIENTS.greyButton}
                onClick={() => buyOrEquipBottle(b.id)}
                disabled={isOn || (!has && !next)}
                title={isOn ? 'Equipped' : has ? 'Equip' : 'Buy'}
                radius={12}
                border={4}
                className="w-full"
                style={{ height: u(64), marginTop: u(12), gap: u(8) }}
              >
                {isOn ? (
                  <span style={{ fontSize: u(32) }}>
                    <StrokeText stroke={u(7)}>EQUIPPED</StrokeText>
                  </span>
                ) : has ? (
                  <span style={{ fontSize: u(34) }}>
                    <StrokeText stroke={u(7)}>EQUIP</StrokeText>
                  </span>
                ) : (
                  <>
                    {!next && <Icon name="close" size={u(30)} />}
                    <Price amount={b.cost} size={32} afford={afford} />
                  </>
                )}
              </ChunkyButton>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

/* ------------------------------------------------------------------- Pets */

function PetsPanel() {
  const profile = useGame((s) => s.profile)
  const world = profile.world || 1
  const slots = maxEquippedPets(profile)
  const [confirmUid, setConfirmUid] = useState(null)
  const { pets, equippedPets } = profile
  const sorted = [...pets].sort((a, b) => petSortKey(profile, b) - petSortKey(profile, a))

  return (
    <Panel title="Pets" icon="pets" width={1180}>
      <div className="flex flex-wrap items-center" style={{ gap: u(18), marginBottom: u(18), fontSize: u(34) }}>
        <StrokeText stroke={u(7)}>
          {pets.length}/{MAX_PET_INVENTORY} pets · {equippedPets.length}/{slots} equipped
        </StrokeText>
        <StrokeText stroke={u(7)} gradient={GRADIENTS.greenButton}>
          {mult(petMultiplier(profile))} Power
        </StrokeText>
        <ChunkyButton gradient={GRADIENTS.purpleButton} onClick={() => actions.equipBestPets()} title="Equip best" radius={12} border={4} className="ml-auto" style={{ height: u(60), padding: `0 ${u(22)}` }}>
          <span style={{ fontSize: u(30) }}>
            <StrokeText stroke={u(7)}>EQUIP BEST</StrokeText>
          </span>
        </ChunkyButton>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3" style={{ gap: u(16), marginBottom: u(22) }}>
        {(WORLD_EGGS[world] || EGG_ORDER).map((id) => {
          const egg = EGGS[id]
          return (
            <div key={id} style={CARD({ padding: u(14) })}>
              <div className="flex items-center" style={{ gap: u(10) }}>
                <Icon name={`egg:${id}`} size={u(70)} />
                <span className="flex flex-col leading-none" style={{ gap: u(6) }}>
                  <span style={{ fontSize: u(32) }}>
                    <StrokeText stroke={u(7)}>{egg.name}</StrokeText>
                  </span>
                  <Price amount={egg.cost} size={26} />
                </span>
              </div>
              <div className="flex flex-col" style={{ marginTop: u(10), gap: u(4) }}>
                {eggOdds(id).map(({ id: petId, pct: p }) => (
                  <div key={petId} className="flex justify-between" style={{ fontSize: u(24) }}>
                    <StrokeText stroke={u(5)} fill={RARITIES[PETS[petId].rarity].color}>
                      {PETS[petId].name}
                    </StrokeText>
                    <StrokeText stroke={u(5)}>
                      {Math.round(p)}% · {mult(PETS[petId].mult)}
                    </StrokeText>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {sorted.length === 0 ? (
        <div className="text-center" style={{ ...CARD({ padding: u(30) }), fontSize: u(34) }}>
          <StrokeText stroke={u(7)}>No pets yet - earn Wins, then hatch an egg at the back of the lobby!</StrokeText>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-5" style={{ gap: u(16) }}>
          {sorted.map((p) => {
            const def = PETS[p.id]
            const on = equippedPets.includes(p.uid)
            const rarity = RARITIES[def.rarity]
            return (
              <div key={p.uid} className="flex flex-col items-center text-center" style={CARD({ padding: u(12), borderColor: on ? '#7dff4a' : '#111' })}>
                <button
                  type="button"
                  className="pp-btn flex flex-col items-center"
                  onClick={() => {
                    if (on) actions.unequipPet(p.uid)
                    else if (equippedPets.length >= slots) toast(`Unequip a pet first (max ${slots})`, 'bad')
                    else actions.equipPet(p.uid)
                  }}
                >
                  <div className="relative grid place-items-center" style={{ width: u(110), height: u(110) }}>
                    <div className="aura" style={{ '--aura': rarity.color }} />
                    <PetFace size={u(96)} body={def.body} ear={def.ear} ears={def.ears} />
                  </div>
                  <span style={{ fontSize: u(26) }}>
                    <StrokeText stroke={u(6)}>{def.name}</StrokeText>
                  </span>
                  <span style={{ fontSize: u(22) }}>
                    <StrokeText stroke={u(5)} fill={rarity.color}>
                      {rarity.name}
                    </StrokeText>
                  </span>
                  <span style={{ fontSize: u(28) }}>
                    <StrokeText stroke={u(6)} gradient={GRADIENTS.greenButton}>
                      {mult(def.mult)}
                    </StrokeText>
                  </span>
                </button>
                <button
                  type="button"
                  className="pp-btn"
                  style={{ fontSize: u(22), marginTop: u(6) }}
                  onClick={() => {
                    if (on) return
                    if (confirmUid === p.uid) {
                      actions.deletePet(p.uid)
                      setConfirmUid(null)
                    } else setConfirmUid(p.uid)
                  }}
                >
                  <StrokeText stroke={u(5)} fill={on ? '#7dff4a' : confirmUid === p.uid ? '#ff6a5a' : '#c0c6d0'}>
                    {on ? 'EQUIPPED' : confirmUid === p.uid ? 'TAP TO DELETE' : 'DELETE'}
                  </StrokeText>
                </button>
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}

/* ---------------------------------------------------------------- Rebirth */

const CARD_GRADIENTS = {
  power: 'linear-gradient(180deg, #8ff0ff 0%, #2fb8ff 50%, #1677ff 100%)',
  after: 'linear-gradient(180deg, #c6ff7a 0%, #6fe04a 50%, #26ad3c 100%)',
  level: 'linear-gradient(180deg, #ffe25a 0%, #ffb21e 55%, #f08a0a 100%)',
}
const PURPLE = 'linear-gradient(180deg, #ffd6ff 0%, #e27bff 50%, #a93cf0 100%)'

function StatCard({ kind, text }) {
  return (
    <div
      className="relative flex items-center justify-center overflow-hidden"
      style={{
        height: u(104),
        borderRadius: u(22),
        background: CARD_GRADIENTS[kind],
        border: `${u(5)} solid #111`,
        boxShadow: `inset 0 ${u(5)} 0 rgba(255,255,255,0.45), inset 0 -${u(6)} 0 rgba(0,0,0,0.18)`,
      }}
    >
      <span className="relative" style={{ fontSize: u(text.length > 11 ? 50 : 60) }}>
        <StrokeText stroke={u(11)}>{text}</StrokeText>
      </span>
    </div>
  )
}

/** Rebirth, as in +1 Kick Field Goal: now against after, progress to max level, Rebirth or Skip. */
function RebirthPanel() {
  const rebirths = useGame((s) => s.profile.rebirths)
  const level = useGame((s) => s.profile.level)
  const progress = useGame((s) => rebirthProgress(s.profile))
  const ready = useGame((s) => isMaxLevel(s.profile))
  const skipPrice = useGame((s) => rebirthSkipPrice(s.profile))
  const canSkip = useGame((s) => s.profile.wins - s.pendingWins >= skipPrice)
  const autoRebirth = useGame((s) => s.profile.settings.autoRebirth)
  const cap = levelCap(rebirths)
  const gift = nextRebirthGift(rebirths)
  const unlock = PADS.find((p) => p.rebirths === rebirths + 1)

  return (
    <Panel title="Rebirth" icon="rebirth" width={920}>
      <div className="grid items-center" style={{ gridTemplateColumns: '1fr auto 1fr', columnGap: u(20), rowGap: u(16) }}>
        <div className="text-center" style={{ fontSize: u(58) }}>
          <StrokeText stroke={u(11)}>Now</StrokeText>
        </div>
        <div />
        <div className="text-center" style={{ fontSize: u(58) }}>
          <StrokeText stroke={u(11)}>After Rebirth</StrokeText>
        </div>
        <StatCard kind="power" text={`${mult(rebirthMultiplier(rebirths))} Power`} />
        <Icon name="fastForward" size={u(80)} />
        <StatCard kind="after" text={`${mult(rebirthMultiplier(rebirths + 1))} Power`} />
        <StatCard kind="level" text={`Max Level ${cap}`} />
        <Icon name="fastForward" size={u(80)} />
        <StatCard kind="level" text={`Max Level ${levelCap(rebirths + 1)}`} />
      </div>

      <p className="m-0 text-center" style={{ fontSize: u(42), marginTop: u(18) }}>
        <StrokeText stroke={u(9)} gradient={PURPLE}>
          Rebirth resets your Level and Power!
        </StrokeText>
      </p>
      {unlock && (
        <p className="m-0 text-center" style={{ fontSize: u(34), marginTop: u(6) }}>
          <StrokeText stroke={u(7)}>Unlocks the{'\u00a0'}</StrokeText>
          <StrokeText stroke={u(7)} fill={unlock.color}>
            {unlock.name} ({unlock.mult}x)
          </StrokeText>
        </p>
      )}
      {gift && (
        <p className="m-0 flex items-center justify-center" style={{ fontSize: u(36), marginTop: u(8), gap: u(10) }}>
          <Icon name={`egg:${gift.egg}`} size={u(54)} />
          <StrokeText stroke={u(8)} gradient={GRADIENTS.gold}>
            {gift.rebirths === rebirths + 1 ? 'This rebirth' : `Rebirth ${gift.rebirths}`} gives {gift.label}!
          </StrokeText>
        </p>
      )}

      <div
        className="relative mx-auto overflow-hidden"
        style={{ width: '88%', marginTop: u(14), height: u(76), borderRadius: u(38), border: `${u(5)} solid #111`, background: '#eef6ff' }}
      >
        <div className="absolute inset-y-0 left-0" style={{ width: `${progress * 100}%`, background: CARD_GRADIENTS.after, borderRadius: u(32) }} />
        <div className="absolute inset-0 flex items-center justify-center" style={{ fontSize: u(50) }}>
          <StrokeText stroke={u(10)}>
            Level {level}/{cap}
          </StrokeText>
        </div>
      </div>

      <div className="flex" style={{ marginTop: u(26), gap: u(22) }}>
        <ChunkyButton
          disabled={!ready}
          onClick={doRebirth}
          gradient={ready ? GRADIENTS.greenButton : GRADIENTS.greyButton}
          className="flex-1"
          style={{ height: u(108) }}
          radius={22}
          border={5}
        >
          <span style={{ fontSize: u(60) }}>
            <StrokeText stroke={u(12)}>{ready ? 'REBIRTH!' : `Need Level ${cap}`}</StrokeText>
          </span>
        </ChunkyButton>
        {!ready && (
          <ChunkyButton onClick={doSkipRebirth} gradient={GRADIENTS.rainbow} className="flex-1" style={{ height: u(108), gap: u(16) }} radius={22} border={5}>
            <span style={{ fontSize: u(60) }}>
              <StrokeText stroke={u(12)}>Skip</StrokeText>
            </span>
            <Price amount={skipPrice} size={48} afford={canSkip} />
          </ChunkyButton>
        )}
      </div>

      <label className="pointer-events-auto flex cursor-pointer items-center justify-center" style={{ marginTop: u(18), gap: u(12), fontSize: u(32) }}>
        <input
          type="checkbox"
          checked={autoRebirth}
          onChange={(e) => actions.setSetting('autoRebirth', e.target.checked)}
          style={{ width: u(34), height: u(34), accentColor: '#3fdc4a' }}
        />
        <StrokeText stroke={u(7)}>Auto Rebirth at max level</StrokeText>
      </label>
    </Panel>
  )
}

/* --------------------------------------------------------------- Settings */

function Toggle({ label, on, onClick, gradient = GRADIENTS.greenButton }) {
  return (
    <ChunkyButton gradient={on ? gradient : GRADIENTS.greyButton} onClick={onClick} title={label} radius={14} border={5} className="flex-1" style={{ height: u(80) }}>
      <span style={{ fontSize: u(38) }}>
        <StrokeText stroke={u(8)}>
          {label}: {on ? 'ON' : 'OFF'}
        </StrokeText>
      </span>
    </ChunkyButton>
  )
}

function SettingsPanel() {
  const preference = useQuality((s) => s.preference)
  const preset = useQuality((s) => s.preset)
  const setPreference = useQuality((s) => s.setPreference)
  const soundOn = useUi((s) => s.soundOn)
  const setSoundOn = useUi((s) => s.setSoundOn)
  const musicOn = useUi((s) => s.musicOn)
  const setMusicOn = useUi((s) => s.setMusicOn)
  const net = useGame((s) => s.net)
  const options = ['auto', 'LOW', 'MEDIUM', 'HIGH']
  return (
    <Panel title="Settings" icon="settings" width={860}>
      <span style={{ fontSize: u(40) }}>
        <StrokeText stroke={u(8)}>Graphics</StrokeText>
      </span>
      <div className="grid grid-cols-4" style={{ gap: u(14), marginTop: u(10) }}>
        {options.map((o) => (
          <ChunkyButton key={o} gradient={preference === o ? GRADIENTS.greenButton : GRADIENTS.slate} onClick={() => {
              setPreference(o)
              // Boxity keeps the player's graphics choice for every game.
              saveGraphicsSetting(getSDK(), o)
            }} title={o} radius={12} border={4} style={{ height: u(72) }}>
            <span style={{ fontSize: u(32) }}>
              <StrokeText stroke={u(7)}>{o === 'auto' ? 'Auto' : o[0] + o.slice(1).toLowerCase()}</StrokeText>
            </span>
          </ChunkyButton>
        ))}
      </div>
      <p className="m-0" style={{ fontSize: u(26), marginTop: u(12) }}>
        <StrokeText stroke={u(5)} fill="#c8d0dc">
          Running {preset}
          {PRESETS[preset].shadows ? ' · shadows' : ' · no shadows'}
          {PRESETS[preset].particles ? ' · particles' : ''} · Auto drops quality below 45 FPS
        </StrokeText>
      </p>
      <div className="flex" style={{ gap: u(16), marginTop: u(22) }}>
        <Toggle label="Sound" on={soundOn} onClick={() => setSoundOn(!soundOn)} />
        <Toggle label="Music" on={musicOn} onClick={() => setMusicOn(!musicOn)} gradient={GRADIENTS.purpleButton} />
      </div>
      <p className="m-0" style={{ fontSize: u(28), marginTop: u(22) }}>
        <StrokeText stroke={u(6)} fill="#c8d0dc">
          {net.mode === 'online' ? `Online · room ${net.roomId} · ${net.players} player${net.players === 1 ? '' : 's'}` : 'Offline · progress saves in this browser'}
        </StrokeText>
      </p>
    </Panel>
  )
}

/** A whoosh when a panel opens or closes (switching panels counts as opening). */
function usePanelSounds(panel) {
  const last = useRef(panel)
  useEffect(() => {
    if (panel && panel !== last.current) sfx.open()
    else if (!panel && last.current) sfx.close()
    last.current = panel
  }, [panel])
}

export function Panels() {
  const panel = useUi((s) => s.panel)
  usePanelSounds(panel)
  if (panel === 'bottles') return <BottleShop />
  if (panel === 'pets') return <PetsPanel />
  if (panel === 'rebirth') return <RebirthPanel />
  if (panel === 'settings') return <SettingsPanel />
  if (panel === 'upgrades') return <UpgradesPanel />
  if (panel === 'daily') return <DailyPanel />
  if (panel === 'gifts') return <GiftsPanel />
  if (panel === 'friends') return <FriendsPanel />
  return null
}

export default Panels
