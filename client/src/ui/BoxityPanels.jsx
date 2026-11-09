import { useEffect, useState } from 'react'


import { useBloxity } from '../bloxity/BloxityContext'
import { getInviteLink, inviteFriend, refreshFriends, useFriends } from '../bloxity/services'
import { toast } from '../game/stores/ui'
import { useGame } from '../store/game'
import { FriendsIcon } from './icons'
import { ChunkyButton } from './hud/parts'
import { GRADIENTS, u } from './hud/style'
import Panel from './panels/Panel'
import StrokeText from './StrokeText'

/* Boxity friends and invites. */

const CARD = {
  borderRadius: u(18),
  border: `${u(5)} solid #111`,
  background: 'linear-gradient(180deg, #3a3f4c 0%, #262a33 100%)',
  boxShadow: `inset 0 ${u(4)} 0 rgba(255,255,255,0.12), 0 ${u(5)} 0 #111`,
}


const STATUS = {
  online: { text: 'Online', color: '#7dff4a' },
  'in-game': { text: 'In a game', color: '#38bdf8' },
  in_game: { text: 'In a game', color: '#38bdf8' },
  away: { text: 'Away', color: '#facc15' },
  offline: { text: 'Offline', color: '#94a3b8' },
}

/** Your Boxity friends, with an invite into this room, and a shareable invite link. */
export function FriendsPanel() {
  const { isLoggedIn } = useBloxity()
  const friends = useFriends()
  const online = useGame((s) => s.net.mode === 'online')
  const [sent, setSent] = useState({})

  useEffect(() => {
    refreshFriends()
  }, [])

  const copyLink = async () => {
    const link = getInviteLink()
    if (!link) return toast('Invites work inside Boxity', 'bad')
    try {
      await navigator.clipboard.writeText(link)
      toast('Invite link copied!', 'good')
    } catch {
      toast(link)
    }
  }

  const invite = async (id) => {
    setSent((s) => ({ ...s, [id]: 'sending' }))
    const ok = await inviteFriend(id)
    setSent((s) => ({ ...s, [id]: ok ? 'sent' : undefined }))
    if (!ok) toast('Could not send that invite', 'bad')
  }

  const sorted = [...friends].sort((a, b) => (a.presence?.status === 'offline') - (b.presence?.status === 'offline'))
  return (
    <Panel title="Friends" iconNode={<FriendsIcon size={u(110)} />} width={900}>
      <ChunkyButton gradient={GRADIENTS.blueButton} onClick={copyLink} title="Copy invite link" radius={14} border={5} className="w-full" style={{ height: u(78) }}>
        <span style={{ fontSize: u(36) }}>
          <StrokeText stroke={u(8)}>Copy invite link</StrokeText>
        </span>
      </ChunkyButton>
      {!isLoggedIn ? (
        <p className="m-0 text-center" style={{ fontSize: u(30), marginTop: u(22) }}>
          <StrokeText stroke={u(6)} fill="#c8d0dc">
            Sign in to Boxity to see your friends.
          </StrokeText>
        </p>
      ) : sorted.length === 0 ? (
        <p className="m-0 text-center" style={{ fontSize: u(30), marginTop: u(22) }}>
          <StrokeText stroke={u(6)} fill="#c8d0dc">
            No friends yet - share the link above!
          </StrokeText>
        </p>
      ) : (
        <div className="flex flex-col" style={{ gap: u(12), marginTop: u(18) }}>
          {sorted.map((f) => {
            const status = STATUS[f.presence?.status] || STATUS.offline
            const state = sent[f._id]
            return (
              <div key={f._id} className="flex items-center" style={{ ...CARD, padding: `${u(10)} ${u(14)}`, gap: u(14) }}>
                <div className="grid shrink-0 place-items-center overflow-hidden rounded-full" style={{ width: u(64), height: u(64), border: `${u(4)} solid #111`, background: GRADIENTS.blueButton }}>
                  {f.pfp ? (
                    <img src={f.pfp} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span style={{ fontSize: u(32) }}>
                      <StrokeText stroke={u(6)}>{(f.displayName || f.username || '?').charAt(0).toUpperCase()}</StrokeText>
                    </span>
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate" style={{ fontSize: u(32) }}>
                    <StrokeText stroke={u(6)}>{f.displayName || f.username}</StrokeText>
                  </span>
                  <span style={{ fontSize: u(24) }}>
                    <StrokeText stroke={u(5)} fill={status.color}>
                      {f.presence?.gameName && f.presence?.status === 'in-game' ? `Playing ${f.presence.gameName}` : status.text}
                    </StrokeText>
                  </span>
                </div>
                <ChunkyButton
                  gradient={state === 'sent' ? GRADIENTS.greyButton : GRADIENTS.greenButton}
                  onClick={() => invite(f._id)}
                  disabled={!online || Boolean(state)}
                  title={online ? 'Invite to this room' : 'Invites need an online room'}
                  radius={12}
                  border={4}
                  style={{ height: u(60), padding: `0 ${u(20)}` }}
                >
                  <span style={{ fontSize: u(28) }}>
                    <StrokeText stroke={u(6)}>{state === 'sent' ? 'Sent' : state === 'sending' ? '…' : 'Invite'}</StrokeText>
                  </span>
                </ChunkyButton>
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}
