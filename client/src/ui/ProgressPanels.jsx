import { useState } from 'react'

import { DAILY_REWARDS, PERK_ORDER, PERKS, PLAYTIME_GIFTS, UPGRADE_ORDER, UPGRADES } from '@shared/balance'
import { fmt } from '@shared/format'
import { dailyStatus, perkCost, perkLevel, upgradeCost, upgradeLevel } from '@shared/logic'

import { actions } from '../net/actions'
import { useGame } from '../store/game'
import { ChunkyButton, Price } from './hud/parts'
import { GRADIENTS, u } from './hud/style'
import Icon from './Icon'
import Panel from './panels/Panel'
import StrokeText from './StrokeText'
import { useNow, usePlaySeconds } from './useClock'

/*
 * Progression panels: Upgrades (Wins upgrades + rebirth perks), the Daily reward
 * calendar, and today's playtime Gifts. Every button sends an intent; the authority
 * checks it and the result comes back as a profile update and a toast.
 */

const CARD = (extra = {}) => ({
  borderRadius: u(18),
  border: `${u(5)} solid #111`,
  background: 'linear-gradient(180deg, #3a3f4c 0%, #262a33 100%)',
  boxShadow: `inset 0 ${u(4)} 0 rgba(255,255,255,0.12), 0 ${u(5)} 0 #111`,
  ...extra,
})

const clock = (seconds) => {
  const s = Math.max(0, Math.ceil(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(r).padStart(2, '0')}`
}

/** Level pips: filled up to `level` out of `max`. */
function Pips({ level, max, color }) {
  return (
    <span className="flex flex-wrap" style={{ gap: u(4), marginTop: u(6) }}>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          style={{ width: u(18), height: u(18), borderRadius: u(5), border: `${u(3)} solid #111`, background: i < level ? color : 'rgba(255,255,255,0.12)' }}
        />
      ))}
    </span>
  )
}

function Row({ icon, name, desc, level, max, color, children }) {
  return (
    <div className="flex items-center" style={CARD({ padding: `${u(12)} ${u(16)}`, gap: u(16) })}>
      <span className="grid shrink-0 place-items-center" style={{ width: u(80), height: u(80) }}>
        <Icon name={icon} size={u(72)} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span style={{ fontSize: u(34) }}>
          <StrokeText stroke={u(7)}>
            {name} <span style={{ fontSize: u(24) }}>Lv {level}/{max}</span>
          </StrokeText>
        </span>
        <span style={{ fontSize: u(24) }}>
          <StrokeText stroke={u(5)} fill="#c8d0dc" style={{ whiteSpace: 'normal' }}>
            {desc}
          </StrokeText>
        </span>
        <Pips level={level} max={max} color={color} />
      </span>
      {children}
    </div>
  )
}

/** Wins upgrades and rebirth perks, on two tabs. */
export function UpgradesPanel() {
  const [tab, setTab] = useState('wins')
  const profile = useGame((s) => s.profile)
  const wins = useGame((s) => s.profile.wins - s.pendingWins)
  const tokens = profile.tokens || 0
  return (
    <Panel title="Upgrades" icon="fastForward" width={940}>
      <div className="flex" style={{ gap: u(12), marginBottom: u(16) }}>
        {[
          ['wins', 'Wins Upgrades'],
          ['perks', `Rebirth Perks (${tokens})`],
        ].map(([id, label]) => (
          <ChunkyButton key={id} gradient={tab === id ? GRADIENTS.goldButton : GRADIENTS.slate} onClick={() => setTab(id)} title={label} radius={12} border={4} className="flex-1" style={{ height: u(66) }}>
            <span style={{ fontSize: u(30) }}>
              <StrokeText stroke={u(6)}>{label}</StrokeText>
            </span>
          </ChunkyButton>
        ))}
      </div>

      {tab === 'wins' ? (
        <div className="flex flex-col" style={{ gap: u(12) }}>
          {UPGRADE_ORDER.map((id) => {
            const def = UPGRADES[id]
            const level = upgradeLevel(profile, id)
            const maxed = level >= def.max
            const cost = maxed ? 0 : upgradeCost(id, level)
            return (
              <Row key={id} icon={def.icon} name={def.name} desc={def.desc} level={level} max={def.max} color="#ffd23f">
                <ChunkyButton
                  gradient={maxed ? GRADIENTS.greyButton : wins >= cost ? GRADIENTS.goldButton : GRADIENTS.greyButton}
                  onClick={() => actions.buyUpgrade(id)}
                  disabled={maxed}
                  title={maxed ? 'Maxed' : `Upgrade ${def.name}`}
                  radius={12}
                  border={4}
                  style={{ height: u(70), minWidth: u(190), padding: `0 ${u(14)}` }}
                >
                  {maxed ? (
                    <span style={{ fontSize: u(30) }}>
                      <StrokeText stroke={u(6)}>MAX</StrokeText>
                    </span>
                  ) : (
                    <Price amount={cost} size={32} afford={wins >= cost} />
                  )}
                </ChunkyButton>
              </Row>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-col" style={{ gap: u(12) }}>
          <p className="m-0 text-center" style={{ fontSize: u(28) }}>
            <StrokeText stroke={u(6)} fill="#c8d0dc">
              Every rebirth gives a token (two on every 5th). Spend them on perks that last forever.
            </StrokeText>
          </p>
          {PERK_ORDER.map((id) => {
            const def = PERKS[id]
            const level = perkLevel(profile, id)
            const maxed = level >= def.max
            const cost = perkCost(level)
            return (
              <Row key={id} icon={def.icon} name={def.name} desc={def.desc} level={level} max={def.max} color="#c084fc">
                <ChunkyButton
                  gradient={maxed ? GRADIENTS.greyButton : tokens >= cost ? GRADIENTS.purpleButton : GRADIENTS.greyButton}
                  onClick={() => actions.buyPerk(id)}
                  disabled={maxed}
                  title={maxed ? 'Maxed' : `Buy ${def.name}`}
                  radius={12}
                  border={4}
                  style={{ height: u(70), minWidth: u(190), padding: `0 ${u(14)}` }}
                >
                  <span className="flex items-center" style={{ fontSize: u(30), gap: u(8) }}>
                    {!maxed && <Icon name="rebirth" size={u(40)} />}
                    <StrokeText stroke={u(6)}>{maxed ? 'MAX' : `${cost} token${cost > 1 ? 's' : ''}`}</StrokeText>
                  </span>
                </ChunkyButton>
              </Row>
            )
          })}
        </div>
      )}
    </Panel>
  )
}

/** The 7-day login calendar. */
export function DailyPanel() {
  const now = useNow(1000)
  const profile = useGame((s) => s.profile)
  const status = dailyStatus(profile, now)
  return (
    <Panel title="Daily Rewards" icon="calendar" width={1000}>
      <p className="m-0 text-center" style={{ fontSize: u(30), marginBottom: u(14) }}>
        <StrokeText stroke={u(6)} fill="#c8d0dc">
          {status.broken ? 'You missed a day - the streak starts over.' : 'Come back every day: the rewards grow all week!'}
        </StrokeText>
      </p>
      <div className="grid grid-cols-4" style={{ gap: u(14) }}>
        {DAILY_REWARDS.map((r, i) => {
          const done = i < status.day
          const today = i === status.day
          return (
            <div
              key={i}
              className={`relative flex flex-col items-center text-center ${i === DAILY_REWARDS.length - 1 ? 'col-span-2' : ''}`}
              style={CARD({
                padding: `${u(12)} ${u(10)}`,
                background: today ? 'linear-gradient(180deg, #6b5a1f 0%, #3d3213 100%)' : done ? 'linear-gradient(180deg, #2f6b33 0%, #1d3f22 100%)' : CARD().background,
                border: `${u(5)} solid ${today ? '#ffd23f' : '#111'}`,
              })}
            >
              <span style={{ fontSize: u(26) }}>
                <StrokeText stroke={u(5)} fill={today ? '#ffd23f' : '#ffffff'}>
                  Day {i + 1}
                </StrokeText>
              </span>
              <span className="relative grid place-items-center" style={{ width: u(90), height: u(90) }}>
                {today && <span className="aura" style={{ '--aura': '#ffd21f' }} />}
                <span className="relative">
                  <Icon name={r.icon} size={u(76)} />
                </span>
              </span>
              <span style={{ fontSize: u(22), minHeight: u(52) }}>
                <StrokeText stroke={u(5)} style={{ whiteSpace: 'normal' }}>
                  {r.label}
                </StrokeText>
              </span>
              {done && (
                <span className="absolute" style={{ top: u(6), right: u(6) }}>
                  <Icon name="check" size={u(40)} />
                </span>
              )}
            </div>
          )
        })}
      </div>
      <ChunkyButton
        gradient={status.canClaim ? GRADIENTS.greenButton : GRADIENTS.greyButton}
        onClick={() => actions.claimDaily()}
        disabled={!status.canClaim}
        title="Claim"
        radius={14}
        border={5}
        className="w-full"
        style={{ height: u(84), marginTop: u(18) }}
      >
        <span style={{ fontSize: u(40) }}>
          <StrokeText stroke={u(8)}>{status.canClaim ? `CLAIM DAY ${status.day + 1}!` : `Next reward in ${clock((status.nextAt - now) / 1000)}`}</StrokeText>
        </span>
      </ChunkyButton>
    </Panel>
  )
}

/** Gifts that open as you play today. */
export function GiftsPanel() {
  const seconds = usePlaySeconds()
  const claimed = useGame((s) => s.profile.playday?.claimed || [])
  return (
    <Panel title="Gifts" icon="items" width={940}>
      <p className="m-0 text-center" style={{ fontSize: u(30), marginBottom: u(14) }}>
        <StrokeText stroke={u(6)} fill="#c8d0dc">
          Played today: {clock(seconds)}. Gifts open while you play and reset every day.
        </StrokeText>
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4" style={{ gap: u(14) }}>
        {PLAYTIME_GIFTS.map((g, i) => {
          const opened = claimed.includes(i)
          const ready = !opened && seconds >= g.minutes * 60
          const left = g.minutes * 60 - seconds
          const progress = Math.min(1, seconds / (g.minutes * 60))
          return (
            <div key={i} className="flex flex-col items-center text-center" style={CARD({ padding: `${u(12)} ${u(10)}`, border: `${u(5)} solid ${ready ? '#7dff4a' : '#111'}`, opacity: opened ? 0.6 : 1 })}>
              <span className="relative grid place-items-center" style={{ width: u(90), height: u(90) }}>
                {ready && <span className="aura" style={{ '--aura': '#7dff4a' }} />}
                <span className={`relative ${ready ? 'pp-bounce' : ''}`}>
                  <Icon name={g.icon} size={u(74)} />
                </span>
              </span>
              <span style={{ fontSize: u(23), minHeight: u(52) }}>
                <StrokeText stroke={u(5)} style={{ whiteSpace: 'normal' }}>
                  {g.label}
                </StrokeText>
              </span>
              {opened || ready ? (
                <ChunkyButton
                  gradient={ready ? GRADIENTS.greenButton : GRADIENTS.greyButton}
                  onClick={() => actions.claimPlaytime(i)}
                  disabled={!ready}
                  title={ready ? 'Open' : 'Opened'}
                  radius={10}
                  border={4}
                  className="w-full"
                  style={{ height: u(56), marginTop: u(6) }}
                >
                  <span style={{ fontSize: u(28) }}>
                    <StrokeText stroke={u(6)}>{ready ? 'OPEN!' : 'OPENED'}</StrokeText>
                  </span>
                </ChunkyButton>
              ) : (
                <span className="relative w-full overflow-hidden" style={{ height: u(56), marginTop: u(6), borderRadius: u(12), border: `${u(4)} solid #111`, background: 'rgba(0,0,0,0.35)' }}>
                  <span className="absolute inset-y-0 left-0" style={{ width: `${progress * 100}%`, background: 'linear-gradient(180deg, #c6ff7a, #26ad3c)' }} />
                  <span className="absolute inset-0 grid place-items-center" style={{ fontSize: u(26) }}>
                    <StrokeText stroke={u(6)}>{clock(left)}</StrokeText>
                  </span>
                </span>
              )}
            </div>
          )
        })}
      </div>
      <p className="m-0 text-center" style={{ fontSize: u(24), marginTop: u(12) }}>
        <StrokeText stroke={u(5)} fill="#c8d0dc">
          {fmt(PLAYTIME_GIFTS.length - claimed.length)} left today
        </StrokeText>
      </p>
    </Panel>
  )
}
