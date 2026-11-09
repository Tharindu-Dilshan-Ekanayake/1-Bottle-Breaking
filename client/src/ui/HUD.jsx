import { useEffect, useState } from 'react'

import { AUTO_THROW_REBIRTHS, BOOSTS, BOTTLES, levelCap, PADS, PERK_ORDER, PERKS, PLAYTIME_GIFTS, powerForLevel, UPGRADE_ORDER, UPGRADES, WORLDS, ZONES } from '@shared/balance'
import { fmt, mult } from '@shared/format'
import {
  adReadyAt,
  canAutoThrow,
  gainMultiplier,
  isMaxLevel,
  isPadUnlocked,
  levelProgress,
  padGain,
  powerPacks,
  boostActive,
  dailyStatus,
  maxEquippedPets,
  perkCost,
  rebirthProgress,
  throwReachFor,
  upgradeCost,
  upgradeLevel,
  zoneForThrow,
} from '@shared/logic'

import { useBloxity } from '../bloxity/BloxityContext'
import { isRewardedAvailable, watchRewardedAd } from '../bloxity/services'
import { sfx } from '../game/audio'
import { toast, useUi } from '../game/stores/ui'
import { zoneLook } from '../game/themes'
import { actions } from '../net/actions'
import { getGame, useGame } from '../store/game'
import { doRebirth, primaryAction, requestThrow } from './actions'
import { useNow, usePlaySeconds } from './useClock'
import Icon from './Icon'
import { AdIcon, BottleIcon, ThemeIcon } from './icons'
import { AlertBadge, ChunkyButton, Price } from './hud/parts'
import { GRADIENTS, u } from './hud/style'
import StrokeText from './StrokeText'
import TutorialCard from './TutorialCard'

/*
 * The heads-up display, built from the +1 Kick Field Goal HUD kit (ChunkyButton,
 * StrokeText, Price, AlertBadge, all sized in --px units): Rebirths and Wins top-left
 * over the menu tiles, sound / music / settings top-right, Power, the level bar and the
 * Power packs along the bottom, the THROW! button above them.
 */

const POWER_FILL = 'linear-gradient(180deg, #fff6a8 0%, #ffd52a 45%, #ff9c00 100%)'
const BOOST = 'linear-gradient(180deg, #d9ff9a 0%, #7dff4a 50%, #28c840 100%)'
const BAR_FILL = 'linear-gradient(180deg, #c6ff7a 0%, #6fe04a 50%, #26ad3c 100%)'
const PACK_GRADIENTS = [
  'linear-gradient(180deg, #ffe25a 0%, #ffb21e 55%, #f08a0a 100%)',
  'linear-gradient(180deg, #ff8a7a 0%, #ff3b3b 50%, #d4142a 100%)',
  'linear-gradient(135deg, #ff5fd2 0%, #8a5cff 35%, #2fb8ff 70%, #5cff9a 100%)',
]
const TILE_GRADIENTS = {
  rebirth: 'linear-gradient(180deg, #b4efff 0%, #4cb8ff 50%, #2477e8 100%)',
  pets: 'linear-gradient(180deg, #ffd99a 0%, #ffa53a 50%, #f07a12 100%)',
  bottles: 'linear-gradient(180deg, #c9ff96 0%, #6fe04a 50%, #26ad3c 100%)',
  gems: 'linear-gradient(180deg, #e9d5ff 0%, #a855f7 50%, #6d28d9 100%)',
  upgrades: 'linear-gradient(180deg, #fde68a 0%, #f59e0b 50%, #d97706 100%)',
  daily: 'linear-gradient(180deg, #bae6fd 0%, #38bdf8 50%, #0284c7 100%)',
  gifts: 'linear-gradient(180deg, #fecdd3 0%, #fb7185 50%, #e11d48 100%)',
  free: 'linear-gradient(180deg, #fff3a8 0%, #ffd23f 50%, #f59e0b 100%)',
}


const FREE_AD = 'free-power'

/**
 * Boxity rewarded ad: watch one for a free Power pack (the biggest). Shown only while
 * Boxity can show an ad here; counts down while it cools off.
 */
function FreeAdTile() {
  const now = useNow(1000)
  const readyAt = useGame((s) => adReadyAt(s.profile, FREE_AD))
  const [busy, setBusy] = useState(false)
  if (!isRewardedAvailable()) return null
  const wait = Math.max(0, readyAt - now)
  const watch = async () => {
    if (busy || wait > 0) return
    setBusy(true)
    const result = await watchRewardedAd(FREE_AD)
    setBusy(false)
    if (!result.ok) toast(result.status === 'skipped' ? 'Watch it to the end for the reward' : 'No ad right now - try again later', 'bad')
  }
  const label = wait > 0 ? `${Math.floor(wait / 60000)}:${String(Math.floor((wait % 60000) / 1000)).padStart(2, '0')}` : busy ? '…' : 'Free!'
  return (
    <MenuTile tile="free" iconNode={<span className={wait > 0 ? '' : 'pp-bounce inline-block'}><AdIcon size={u(80)} /></span>} label={label} alert={wait === 0 && !busy} onClick={watch} />
  )
}

/* ----------------------------------------------------------------- Stats */

function StatRow({ icon, iconNode, value, gradient }) {
  return (
    <div className="relative flex items-center" style={{ height: u(86) }}>
      {iconNode || <Icon name={icon} size={u(86)} className="relative" />}
      {/* Keyed on the value: every change replays a little bump. */}
      <span key={value} className="pp-bump relative" style={{ fontSize: u(64), marginLeft: u(8) }}>
        <StrokeText stroke={u(12)} gradient={gradient}>
          {value}
        </StrokeText>
      </span>
    </div>
  )
}

/** Top-left: Rebirths, then Wins, and how far a throw would go right now. */
function StatsPanel() {
  const wins = useGame((s) => s.profile.wins - s.pendingWins)
  const rebirths = useGame((s) => s.profile.rebirths)
  const range = useGame((s) => Math.round(throwReachFor(s.profile)))
  const zi = zoneForThrow(range)
  return (
    <div className="pointer-events-none absolute flex flex-col" style={{ left: u(22), top: 'var(--hud-top)' }}>
      <StatRow icon="rebirth" value={fmt(rebirths)} />
      <StatRow icon="trophy" value={fmt(wins)} gradient={GRADIENTS.gold} />
      <span className="hidden sm:inline" style={{ fontSize: u(30), marginTop: u(4) }}>
        <StrokeText stroke={u(7)}>
          Throw ~{fmt(range)} stairs ·{'\u00a0'}
        </StrokeText>
        <StrokeText stroke={u(7)} fill={zoneLook(zi).accent}>
          {ZONES[zi].name}
        </StrokeText>
      </span>
    </div>
  )
}

/** Which world you're in (World 2 and up), as a chip at the top centre. */
function WorldChip() {
  const world = useGame((s) => s.profile.world || 1)
  if (world < 2) return null
  const w = WORLDS[world]
  return (
    <div className="pointer-events-none absolute inset-x-0 flex justify-center" style={{ top: u(108) }}>
      <span className="flex items-center" style={{ fontSize: u(26), gap: u(8), padding: `${u(4)} ${u(16)} ${u(6)}`, borderRadius: u(40), background: 'rgba(14,18,28,0.62)', border: `${u(3)} solid #f472b6` }}>
        <StrokeText stroke={u(5)} fill="#f9a8d4">
          World {world} · {w.name}
        </StrokeText>
        <StrokeText stroke={u(5)} gradient={GRADIENTS.gold}>
          x{w.gain}
        </StrokeText>
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------- Menu */

/** Each tile's accent: the rim glow and the label pill's edge. */
const TILE_ACCENT = {
  rebirth: '#4cb8ff',
  pets: '#ffa53a',
  bottles: '#6fe04a',
  upgrades: '#fbbf24',
  daily: '#38bdf8',
  gifts: '#fb7185',
  free: '#ffd23f',
}

function MenuTile({ tile, iconNode, label, title = label, onClick, alert, top }) {
  return (
    <ChunkyButton
      gradient={TILE_GRADIENTS[tile]}
      onClick={onClick}
      title={title}
      radius={22}
      className={`menu-tile flex-col ${alert ? 'menu-alert' : ''}`}
      style={{ width: u(112), height: u(112), '--accent': TILE_ACCENT[tile] }}
    >
      <span className="menu-halo absolute" />
      <span className="menu-icon" style={{ marginTop: u(-14) }}>{iconNode}</span>
      <span className="menu-ribbon absolute whitespace-nowrap" style={{ bottom: u(-20), fontSize: u(label.length > 6 ? 24 : 28) }}>
        <StrokeText stroke={u(5)}>{label}</StrokeText>
      </span>
      {top && !alert && (
        <span className="absolute" style={{ top: u(-22), fontSize: u(30) }}>
          <StrokeText stroke={u(7)} className="italic">
            {top}
          </StrokeText>
        </span>
      )}
      {alert && <AlertBadge size={40} style={{ top: u(-12), right: u(-14) }} />}
    </ChunkyButton>
  )
}

/** The menu on the left, under the stats: Rebirth (with % to go), Pets, Bottles. */
function LeftMenu() {
  const togglePanel = useUi((s) => s.openPanel)
  const rebirthPct = useGame((s) => Math.floor(rebirthProgress(s.profile) * 100))
  const petAlert = useGame((s) => s.profile.equippedPets.length < Math.min(maxEquippedPets(s.profile), s.profile.pets.length))
  const upgradeAlert = useGame((s) => {
    const p = s.profile
    const wins = p.wins - s.pendingWins
    const affordable = UPGRADE_ORDER.some((id) => upgradeLevel(p, id) < UPGRADES[id].max && wins >= upgradeCost(id, upgradeLevel(p, id)))
    const perk = PERK_ORDER.some((id) => (p.perks?.[id] || 0) < PERKS[id].max && p.tokens >= perkCost(p.perks?.[id] || 0))
    return affordable || perk
  })
  const bottleAlert = useGame((s) => {
    const next = BOTTLES.find((b) => !s.profile.ownedBottles.includes(b.id))
    return Boolean(next) && s.profile.wins - s.pendingWins >= next.cost
  })
  return (
    <div className="left-menu pointer-events-none absolute grid" style={{ left: u(18), top: `calc(var(--hud-top) + ${u(250)})`, gap: u(14), rowGap: u(34) }}>
      <MenuTile tile="rebirth" iconNode={<Icon name="rebirth" size={u(84)} />} label="Rebirth" top={`${rebirthPct}%`} alert={rebirthPct >= 100} onClick={() => togglePanel('rebirth')} />
      <MenuTile tile="pets" iconNode={<Icon name="pets" size={u(84)} />} label="Pets" alert={petAlert} onClick={() => togglePanel('pets')} />
      <MenuTile tile="bottles" iconNode={<BottleIcon size={u(80)} fill="#ff6fb5" glass="#fbf5ff" cap="#ffd23f" />} label="Bottles" alert={bottleAlert} onClick={() => togglePanel('bottles')} />
      <MenuTile tile="upgrades" iconNode={<Icon name="fastForward" size={u(76)} />} label="Upgrade" alert={upgradeAlert} onClick={() => togglePanel('upgrades')} />
      <DailyTile onClick={() => togglePanel('daily')} />
      <GiftsTile onClick={() => togglePanel('gifts')} />
    </div>
  )
}

/** Daily reward: a "!" when today's is waiting. */
function DailyTile({ onClick }) {
  const now = useNow(30000)
  const ready = useGame((s) => dailyStatus(s.profile, now).canClaim)
  return <MenuTile tile="daily" iconNode={<Icon name="calendar" size={u(76)} />} label="Daily" alert={ready} onClick={onClick} />
}

/** Playtime gifts: a "!" when one has opened, else a countdown to the next. */
function GiftsTile({ onClick }) {
  const seconds = usePlaySeconds()
  const claimed = useGame((s) => s.profile.playday?.claimed || [])
  const next = PLAYTIME_GIFTS.findIndex((g, i) => !claimed.includes(i))
  const ready = next >= 0 && PLAYTIME_GIFTS.some((g, i) => !claimed.includes(i) && seconds >= g.minutes * 60)
  const wait = next >= 0 ? Math.max(0, PLAYTIME_GIFTS[next].minutes * 60 - seconds) : 0
  const label = ready || next < 0 ? 'Gifts' : `${Math.floor(wait / 60)}:${String(Math.floor(wait % 60)).padStart(2, '0')}`
  return <MenuTile tile="gifts" iconNode={<Icon name="items" size={u(76)} />} label={label} title="Gifts" alert={ready} onClick={onClick} />
}

/** Top-right, under the round buttons: a free Power pack for an ad (when Boxity can show one). */
function RightMenu() {
  return (
    <div className="pointer-events-none absolute flex flex-col items-end" style={{ right: u(18), top: u(184), gap: u(34) }}>
      <FreeAdTile />
    </div>
  )
}

/** Running boosts (x2 Power, x2 Wins) with the time they have left. */
function BoostChips() {
  const now = useNow(1000)
  const boosts = useGame((s) => s.profile.boosts || {})
  const active = Object.keys(BOOSTS).filter((id) => boostActive({ boosts }, id, now))
  if (!active.length) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 flex justify-center" style={{ top: u(64), gap: u(10) }}>
      {active.map((id) => {
        const left = Math.max(0, boosts[id] - now) / 1000
        return (
          <span
            key={id}
            className="flex items-center"
            style={{ fontSize: u(26), gap: u(8), padding: `${u(4)} ${u(16)} ${u(6)}`, borderRadius: u(40), background: 'rgba(14,18,28,0.7)', border: `${u(3)} solid ${BOOSTS[id].color}` }}
          >
            <StrokeText stroke={u(5)} fill={BOOSTS[id].color}>
              {BOOSTS[id].name}
            </StrokeText>
            <StrokeText stroke={u(5)}>
              {Math.floor(left / 60)}:{String(Math.floor(left % 60)).padStart(2, '0')}
            </StrokeText>
          </span>
        )
      })}
    </div>
  )
}

/** "Welcome to World 2!" when you come through the portal. */
function WorldBanner() {
  const arrive = useUi((s) => s.worldArrive)
  const [doneId, setDoneId] = useState(null)
  useEffect(() => {
    if (!arrive) return undefined
    const t = setTimeout(() => setDoneId(arrive.id), 2800)
    return () => clearTimeout(t)
  }, [arrive])
  if (!arrive || doneId === arrive.id) return null
  const w = WORLDS[arrive.world]
  return (
    <div key={arrive.id} className="pointer-events-none absolute inset-0">
      <div className="anim-flash absolute inset-0 bg-white" />
      <div className="anim-levelup absolute inset-x-0 flex flex-col items-center" style={{ top: '30%' }}>
        <span style={{ fontSize: u(48) }}>
          <StrokeText stroke={u(10)}>{arrive.unlocked ? 'World unlocked!' : 'Welcome to'}</StrokeText>
        </span>
        <span style={{ fontSize: u(100) }}>
          <StrokeText stroke={u(18)} gradient={arrive.world === 2 ? 'linear-gradient(180deg, #ffe4f1 0%, #f472b6 60%, #c026d3 100%)' : GRADIENTS.greenButton}>
            {w?.name || arrive.name}
          </StrokeText>
        </span>
        {w && w.gain > 1 && (
          <span style={{ fontSize: u(42) }}>
            <StrokeText stroke={u(9)} gradient={GRADIENTS.gold}>
              x{w.gain} Power · x{w.wins} Wins
            </StrokeText>
          </span>
        )}
      </div>
    </div>
  )
}

function RoundButton({ icon, label, onClick, iconSize = 38 }) {
  return (
    <ChunkyButton gradient={GRADIENTS.slate} onClick={onClick} title={label} radius={32} style={{ width: u(64), height: u(64) }}>
      <Icon name={icon} size={u(iconSize)} />
    </ChunkyButton>
  )
}

/** Top-right: sound and settings (music and the rest are in Settings). */
function TopBar() {
  const soundOn = useUi((s) => s.soundOn)
  const setSoundOn = useUi((s) => s.setSoundOn)
  const openPanel = useUi((s) => s.openPanel)
  return (
    <div className="pointer-events-none absolute flex items-center" style={{ right: u(16), top: u(96), gap: u(12) }}>
      <RoundButton icon={soundOn ? 'sound' : 'soundOff'} label={soundOn ? 'Sound: on' : 'Sound: off'} onClick={() => setSoundOn(!soundOn)} iconSize={36} />
      <RoundButton icon="settings" label="Settings" onClick={() => openPanel('settings')} iconSize={42} />
    </div>
  )
}

/**
 * Only shown when this account started playing in another window (this one stopped).
 * No online count / Offline pill: the user asked for it to be removed.
 */
function NetChip() {
  const replaced = useGame((s) => s.net.mode === 'replaced')
  if (!replaced) return null
  return (
    <span
      className="flex items-center"
      style={{ fontSize: u(26), gap: u(10), padding: `${u(4)} ${u(18)} ${u(6)}`, borderRadius: u(40), background: 'rgba(14,18,28,0.62)', border: `${u(3)} solid rgba(255,255,255,0.14)` }}
    >
      <span style={{ width: u(14), height: u(14), borderRadius: '50%', background: '#cbd5e1' }} />
      <StrokeText stroke={u(5)}>Playing in another window</StrokeText>
    </span>
  )
}

/* ------------------------------------------------------- Bottom: Power bar */

/**
 * "Level 12 ... 6/10": your level and how much of the Power this level needs you have.
 * At max level it reads "MAX LEVEL 15 ... Rebirth!" and rebirths.
 */
function LevelBar() {
  const level = useGame((s) => s.profile.level)
  const power = useGame((s) => s.profile.power)
  const maxed = useGame((s) => isMaxLevel(s.profile))
  const fill = useGame((s) => levelProgress(s.profile))
  const cap = useGame((s) => levelCap(s.profile.rebirths))
  const levelUp = useUi((s) => s.levelUp)
  const from = powerForLevel(level)
  const to = powerForLevel(level + 1)
  return (
    <button
      type="button"
      onClick={maxed ? doRebirth : undefined}
      className={`relative w-full overflow-hidden text-left ${maxed ? 'pp-btn pointer-events-auto' : 'pointer-events-none'}`}
      style={{
        height: u(70),
        borderRadius: u(12),
        border: `${u(6)} solid #111`,
        background: 'rgba(40, 44, 56, 0.85)',
        boxShadow: `0 ${u(5)} 0 #111, inset 0 ${u(-6)} 0 rgba(0,0,0,0.2)`,
      }}
    >
      {/* Grows by a transform, not its width, so a Power gain never re-lays-out the page. */}
      <div
        className="absolute inset-0 origin-left transition-transform duration-300 ease-out"
        style={{ transform: `scaleX(${fill})`, background: maxed ? GRADIENTS.purpleButton : BAR_FILL }}
      />
      <div className="absolute" style={{ left: u(10), right: u(10), top: u(5), height: u(12), borderRadius: u(6), background: 'rgba(255,255,255,0.25)' }} />
      <div className="absolute inset-0 flex items-center justify-between" style={{ padding: `0 ${u(18)}`, fontSize: u(50) }}>
        <span key={levelUp?.id} className={levelUp ? 'pp-bump' : ''}>
          <StrokeText stroke={u(10)}>{maxed ? `MAX LEVEL ${cap}` : `Level ${level}`}</StrokeText>
        </span>
        <StrokeText stroke={u(10)}>{maxed ? 'Rebirth!' : `${fmt(Math.max(0, power - from))}/${fmt(to - from)}`}</StrokeText>
      </div>
    </button>
  )
}

/** A Power pack: "+10K" with a muscle, its price in Wins in the corner. */
function PackButton({ index, amount, price, afford }) {
  const buy = () => {
    if (getGame().profile.wins - getGame().pendingWins < price) {
      sfx.error()
      return
    }
    actions.buyPack(index)
  }
  return (
    <ChunkyButton gradient={PACK_GRADIENTS[index]} onClick={buy} title={`+${fmt(amount)} Power`} radius={8} border={5} style={{ width: u(290), height: u(76) }}>
      <Icon name="muscle" size={u(62)} className="absolute" style={{ left: u(10) }} />
      <span className="relative" style={{ fontSize: u(48), marginLeft: u(30) }}>
        <StrokeText stroke={u(10)}>+{fmt(amount)}</StrokeText>
      </span>
      <span className="absolute" style={{ right: u(8), bottom: u(4) }}>
        <Price amount={price} size={26} afford={afford} />
      </span>
    </ChunkyButton>
  )
}

/** Bottom centre: your Power and its boost, the level bar, the three Power packs. */
function PowerBar() {
  const power = useGame((s) => s.profile.power)
  const level = useGame((s) => s.profile.level)
  const rebirths = useGame((s) => s.profile.rebirths)
  const wins = useGame((s) => s.profile.wins - s.pendingWins)
  const boost = useGame((s) => gainMultiplier(s.profile))
  const packs = powerPacks({ level, rebirths })
  return (
    <div className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 flex-col items-center" style={{ bottom: 'var(--bar-bottom)', width: u(900), gap: u(8) }}>
      <div className="relative flex w-full items-end justify-between" style={{ height: u(84) }}>
        <span className="flex items-center" style={{ gap: u(6) }}>
          <Icon name="muscle" size={u(92)} />
          <span key={fmt(power)} className="pp-bump" style={{ fontSize: u(72), lineHeight: 1 }}>
            <StrokeText stroke={u(13)} gradient={POWER_FILL}>
              {fmt(power)} Power
            </StrokeText>
          </span>
        </span>
        <span style={{ fontSize: u(38), marginBottom: u(4) }}>
          <StrokeText stroke={u(8)} gradient={BOOST}>
            {mult(boost)} Power Boost
          </StrokeText>
        </span>
      </div>
      <LevelBar />
      <div className="flex w-full justify-between" style={{ marginTop: u(4) }}>
        {packs.map((pack, i) => (
          <PackButton key={i} index={i} amount={pack.amount} price={pack.price} afford={wins >= pack.price} />
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------- Above the bar: actions */

/** Status text in the game's outlined style, popping in. */
function Pill({ children, fill = '#ffffff' }) {
  return (
    <span className="anim-pop" style={{ fontSize: u(44) }}>
      <StrokeText stroke={u(10)} fill={fill}>
        {children}
      </StrokeText>
    </span>
  )
}

/**
 * The big button for where you're standing: THROW! on the throw platform (breathing a
 * green glow), Buy / Equip at a shop pedestal, Hatch at an egg - or a status line in a
 * training pit.
 */
function ActionArea() {
  const nearby = useUi((s) => s.nearby)
  const mode = useUi((s) => s.mode)
  const training = useUi((s) => s.training)
  const stageReady = useUi((s) => s.stageReady)
  const pending = useUi((s) => s.throwPending)
  const pedestal = useUi((s) => s.pedestal)
  const profile = useGame((s) => s.profile)
  if (mode !== 'walk') return null

  if (nearby === 'launch') {
    const autoUnlocked = canAutoThrow(profile)
    const auto = profile.settings.autoThrow
    return (
      <>
        <ChunkyButton
          gradient={pending ? GRADIENTS.goldButton : GRADIENTS.greenButton}
          onClick={requestThrow}
          disabled={!stageReady || pending}
          title="Throw"
          radius={56}
          border={6}
          className="pp-roll-btn"
          style={{ width: u(430), height: u(112), gap: u(12), paddingLeft: u(14), paddingRight: u(30) }}
        >
          <span className="roll-shine-clip absolute" aria-hidden="true">
            <span className="roll-shine" />
          </span>
          <span className="roll-medal grid shrink-0 place-items-center" style={{ width: u(88), height: u(88) }}>
            <BottleIcon size={u(70)} fill="#ffd23f" glass="#fffbe0" cap="#22c55e" />
          </span>
          <span style={{ fontSize: u(64) }}>
            <StrokeText stroke={u(12)} gradient="linear-gradient(180deg, #ffffff 0%, #fff6b0 100%)">
              {!stageReady ? '...' : 'THROW!'}
            </StrokeText>
          </span>
        </ChunkyButton>
        <ChunkyButton
          gradient={autoUnlocked ? (auto ? GRADIENTS.goldButton : GRADIENTS.greyButton) : GRADIENTS.slate}
          onClick={() => (autoUnlocked ? actions.setSetting('autoThrow', !auto) : sfx.error())}
          title="Auto Throw"
          radius={10}
          border={4}
          style={{ height: u(56), padding: `0 ${u(20)}`, marginTop: u(14) }}
        >
          <span style={{ fontSize: u(32) }}>
            <StrokeText stroke={u(7)}>{autoUnlocked ? `Auto Throw: ${auto ? 'ON' : 'OFF'}` : `Auto Throw: ${AUTO_THROW_REBIRTHS} Rebirth`}</StrokeText>
          </span>
        </ChunkyButton>
      </>
    )
  }

  if (nearby?.startsWith('pad:')) {
    const index = Number(nearby.slice(4))
    const pad = PADS[index]
    if (!isPadUnlocked(profile, index)) return <Pill fill="#ff8a8a">LOCKED · {pad.rebirths} Rebirth{pad.rebirths > 1 ? 's' : ''}</Pill>
    if (isMaxLevel(profile)) return <Pill fill="#7dff4a">MAX LEVEL! Rebirth to keep training</Pill>
    return training ? (
      <Pill fill="#7dff4a">
        {pad.name} · +{fmt(padGain(profile, index))} per bounce
      </Pill>
    ) : (
      <Pill>Stand still to train · {pad.mult}x</Pill>
    )
  }

  // At a pedestal or an egg stand the floating prompt (ProximityPrompt) takes over.
  if ((nearby === 'shop' && pedestal >= 0) || nearby?.startsWith('egg:') || nearby === 'portal') return null

  if (nearby === 'shop') {
    return (
      <ChunkyButton gradient={GRADIENTS.blueButton} onClick={primaryAction} title="Bottle Shop" radius={12} border={6} style={{ height: u(92), padding: `0 ${u(30)}` }}>
        <span style={{ fontSize: u(52) }}>
          <StrokeText stroke={u(11)}>BOTTLE SHOP</StrokeText>
        </span>
      </ChunkyButton>
    )
  }

  return null
}

/* ------------------------------------------------------------------ Throw */

/**
 * The stage bar across the top while the bottle tumbles: the stage you're in and the
 * next few, sized by their stairs, each with its theme's icon; your marker slides along,
 * and a flag marks your best throw.
 */
function StageTrack({ stair, zone }) {
  const best = useGame((s) => s.profile.stats.bestStairs)
  const { identity } = useBloxity()
  const first = Math.max(0, zone - 1)
  const last = Math.min(ZONES.length - 1, first + 5)
  const startStair = ZONES[first].start
  const endOf = (i) => (i + 1 < ZONES.length ? ZONES[i + 1].start : ZONES[i].start + 400)
  const span = endOf(last) - startStair
  const at = (s) => Math.min(1, Math.max(0, (s - startStair) / span))
  const pos = at(stair)
  const segments = []
  for (let i = first; i <= last; i += 1) segments.push(i)
  const name = identity?.displayName || identity?.username || 'You'
  return (
    <div className="relative" style={{ width: `min(${u(1000)}, 94vw)` }}>
      <div
        className="relative flex overflow-hidden"
        style={{ height: u(64), borderRadius: u(32), border: `${u(6)} solid #111`, boxShadow: `0 ${u(5)} 0 #111`, background: '#222' }}
      >
        {segments.map((i) => {
          const look = zoneLook(i)
          return (
            <div
              key={i}
              className="relative flex items-center justify-center"
              style={{
                width: `${((endOf(i) - ZONES[i].start) / span) * 100}%`,
                background: `linear-gradient(180deg, ${look.lane[0]}, ${look.terrace[0]})`,
                borderRight: i < last ? `${u(4)} solid #111` : 'none',
                filter: i <= zone ? 'none' : 'saturate(0.5) brightness(0.85)',
              }}
            >
              <span className={i === zone ? 'pp-bounce' : ''}>
                <ThemeIcon theme={ZONES[i].theme} size={u(i === zone ? 46 : 36)} />
              </span>
            </div>
          )
        })}
        <div className="pointer-events-none absolute inset-y-0 left-0 transition-[width] duration-150" style={{ width: `${pos * 100}%`, background: 'linear-gradient(180deg, rgba(255,255,255,0.5), rgba(255,255,255,0.08))' }} />
        <div className="absolute" style={{ left: u(14), right: u(14), top: u(4), height: u(10), borderRadius: u(5), background: 'rgba(255,255,255,0.3)' }} />
      </div>
      {best > startStair && best < startStair + span && (
        <div className="absolute flex -translate-x-1/2 flex-col items-center" style={{ left: `${at(best) * 100}%`, top: u(-34) }}>
          <span style={{ fontSize: u(24) }}>
            <StrokeText stroke={u(6)} fill="#ff5c7c">
              BEST
            </StrokeText>
          </span>
          <div style={{ width: u(6), height: u(70), background: '#ff3b5c', border: `${u(2)} solid #111` }} />
        </div>
      )}
      <div className="absolute flex -translate-x-1/2 flex-col items-center transition-[left] duration-150" style={{ left: `${pos * 100}%`, top: u(54) }}>
        <div style={{ width: 0, height: 0, borderLeft: `${u(12)} solid transparent`, borderRight: `${u(12)} solid transparent`, borderBottom: `${u(14)} solid #111` }} />
        <div
          className="grid place-items-center overflow-hidden rounded-full"
          style={{ width: u(64), height: u(64), border: `${u(5)} solid #111`, background: GRADIENTS.goldButton, boxShadow: `0 ${u(4)} 0 #111` }}
        >
          {identity?.pfp ? (
            <img src={identity.pfp} alt="" className="h-full w-full object-cover" />
          ) : (
            <span style={{ fontSize: u(36) }}>
              <StrokeText stroke={u(7)}>{name.charAt(0).toUpperCase()}</StrokeText>
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function ThrowHud() {
  const mode = useUi((s) => s.mode)
  const stair = useUi((s) => s.throwStair)
  const zone = useUi((s) => s.throwZone)
  const earned = useUi((s) => s.throwEarned)
  const winsCollected = useUi((s) => s.throwWins)
  const resultUp = useUi((s) => s.result !== null)
  if (mode !== 'throw') return null
  return (
    <div className="pointer-events-none absolute inset-x-0 flex flex-col items-center" style={{ top: u(40) }}>
      <StageTrack stair={stair} zone={zone} />
      {/* The result card takes over the middle once the bottle smashes. */}
      <div className="flex flex-col items-center" style={{ visibility: resultUp ? 'hidden' : 'visible' }}>
        <span key={stair} className="pp-bump" style={{ fontSize: u(110), marginTop: u(90), transformOrigin: 'center' }}>
          <StrokeText stroke={u(18)} gradient={GRADIENTS.gold}>
            {fmt(stair)} STAIRS
          </StrokeText>
        </span>
        {/* Keyed on the stage: each new stage pops its name in (this is the stage banner). */}
        <span key={`z${zone}`} className="anim-levelup" style={{ fontSize: u(zone > 0 ? 50 : 42) }}>
          <StrokeText stroke={u(10)} fill={zoneLook(zone).accent}>
            Stage {zone + 1} · {ZONES[zone].name}
          </StrokeText>
        </span>
        <span className="flex items-center" style={{ gap: u(24), fontSize: u(40), marginTop: u(6) }}>
          {earned > 0 && (
            <span className="flex items-center" style={{ gap: u(6) }}>
              <Icon name="muscle" size={u(52)} />
              <StrokeText stroke={u(8)} gradient={POWER_FILL}>
                +{fmt(earned)}
              </StrokeText>
            </span>
          )}
          {winsCollected > 0 && <Price amount={winsCollected} size={40} />}
        </span>
      </div>
    </div>
  )
}

/** The shatter result: big outlined numbers over sun rays. */
function ResultCard() {
  const result = useUi((s) => s.result)
  if (!result) return null
  const accent = zoneLook(result.zone).accent
  return (
    <div key={result.stairs} className="pointer-events-none absolute inset-0 grid place-items-center">
      <div className="pp-rays absolute" style={{ width: u(900), height: u(900), background: `repeating-conic-gradient(from 0deg, ${accent}66 0deg 9deg, transparent 9deg 24deg)` }} />
      <div className="anim-pop relative flex flex-col items-center">
        <span style={{ fontSize: u(110) }}>
          <StrokeText stroke={u(18)} gradient={GRADIENTS.gold}>
            SMASHED!
          </StrokeText>
        </span>
        {result.best && (
          <span className="pp-bounce" style={{ fontSize: u(46) }}>
            <StrokeText stroke={u(9)} fill="#ff5c7c">
              NEW BEST!
            </StrokeText>
          </span>
        )}
        <span style={{ fontSize: u(84), marginTop: u(6) }}>
          <StrokeText stroke={u(15)}>{fmt(result.stairs)} STAIRS</StrokeText>
        </span>
        <span style={{ fontSize: u(40) }}>
          <StrokeText stroke={u(8)} fill={accent}>
            {ZONES[result.zone].name}
          </StrokeText>
        </span>
        <span className="flex items-center" style={{ gap: u(30), marginTop: u(14) }}>
          {result.power > 0 && (
            <span className="flex items-center" style={{ gap: u(8), fontSize: u(54) }}>
              <Icon name="muscle" size={u(64)} />
              <StrokeText stroke={u(11)} gradient={POWER_FILL}>
                +{fmt(result.power)}
              </StrokeText>
            </span>
          )}
          <Price amount={result.wins + result.prize} size={58} />
        </span>
        {result.prize > 0 && (
          <span style={{ fontSize: u(36), marginTop: u(8) }}>
            <StrokeText stroke={u(8)} fill="#7dff4a">
              New stage found! +{fmt(result.prize)} Wins
            </StrokeText>
          </span>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Misc */

function Toasts() {
  const toasts = useUi((s) => s.toasts)
  return (
    // Low in the middle, just above the context buttons: clear of the prompt that floats
    // over pedestals and eggs, of the stage track up top, and of the touch controls.
    <div
      className="pointer-events-none absolute inset-x-0 flex flex-col-reverse items-center"
      style={{ bottom: `calc(var(--action-bottom) + ${u(150)})`, gap: u(8) }}
    >
      {toasts.map((t) => (
        <span key={t.id} className="anim-float" style={{ fontSize: u(40) }}>
          <StrokeText stroke={u(9)} fill={t.tone === 'bad' ? '#ff8a8a' : t.tone === 'good' ? '#7dff4a' : '#ffffff'}>
            {t.text}
          </StrokeText>
        </span>
      ))}
    </div>
  )
}

/** "LEVEL UP!" pop in the middle of the screen. */
function LevelUpPop() {
  const levelUp = useUi((s) => s.levelUp)
  const [hiddenId, setHiddenId] = useState(null)
  useEffect(() => {
    if (!levelUp) return undefined
    const t = setTimeout(() => setHiddenId(levelUp.id), 1100)
    return () => clearTimeout(t)
  }, [levelUp])
  if (!levelUp || hiddenId === levelUp.id) return null
  return (
    <div key={levelUp.id} className="anim-levelup pointer-events-none absolute inset-x-0 flex flex-col items-center" style={{ top: '30%' }}>
      <span style={{ fontSize: u(96) }}>
        <StrokeText stroke={u(16)} gradient={GRADIENTS.greenButton}>
          LEVEL UP!
        </StrokeText>
      </span>
      <span style={{ fontSize: u(48) }}>
        <StrokeText stroke={u(10)}>Level {levelUp.level}</StrokeText>
      </span>
    </div>
  )
}

/** Every button clicks; on a desktop it also ticks when the pointer moves onto it. */
function useButtonSounds() {
  useEffect(() => {
    const onDown = (e) => {
      if (e.target.closest?.('button:not(:disabled)')) sfx.click()
    }
    const onOver = (e) => {
      if (e.pointerType !== 'mouse') return
      const btn = e.target.closest?.('button:not(:disabled)')
      if (btn && !btn.contains(e.relatedTarget)) sfx.hover()
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerover', onOver)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerover', onOver)
    }
  }, [])
}

function useActionKey() {
  useEffect(() => {
    const onKey = (e) => {
      if (e.code === 'KeyE' && !e.repeat) primaryAction()
      if (e.code === 'Escape') useUi.setState({ panel: null })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export function HUD() {
  useActionKey()
  useButtonSounds()
  const mode = useUi((s) => s.mode)
  const panelOpen = useUi((s) => s.panel !== null || s.hatching !== null)
  const walking = mode === 'walk'
  return (
    <div className="pp-font pointer-events-none absolute inset-0 z-10 select-none">
      <div className="absolute inset-0 transition-opacity duration-150" style={{ opacity: panelOpen ? 0 : 1, visibility: panelOpen ? 'hidden' : 'visible' }}>
        {/* Hidden, not unmounted, while the bottle flies: no remount hitch on the way back. */}
        <div className="contents" style={{ visibility: walking ? 'visible' : 'hidden' }}>
          <StatsPanel />
          <LeftMenu />
          <TopBar />
          <RightMenu />
          <BoostChips />
          <WorldChip />
          <TutorialCard />
          <div className="pointer-events-none absolute inset-x-0 flex justify-center" style={{ top: u(14) }}>
            <NetChip />
          </div>
          <PowerBar />
          <div className="pointer-events-none absolute inset-x-0 flex flex-col items-center" style={{ bottom: 'var(--action-bottom)' }}>
            <ActionArea />
          </div>
        </div>
        <ThrowHud />
      </div>
      <ResultCard />
      <WorldBanner />
      <LevelUpPop />
      <Toasts />
    </div>
  )
}

export default HUD
