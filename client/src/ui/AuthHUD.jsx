import { useBloxity } from '../bloxity/BloxityContext'
import { useUi } from '../game/stores/ui'
import { GRADIENTS, u } from './hud/style'
import StrokeText from './StrokeText'

/**
 * Your name tag (top-right): picture and name, from `getUser() || getGuest()`, so there
 * is always a name to show. No Log in / Log out here: Boxity's own toolbar handles
 * accounts.
 */
export function AuthHUD() {
  const { identity } = useBloxity()
  const throwing = useUi((s) => s.mode === 'throw')
  // Panels and the hatch have the top of the screen to themselves.
  const covered = useUi((s) => s.panel !== null || s.hatching !== null)
  const name = identity?.displayName || identity?.username || 'Guest'
  const pfp = identity?.pfp
  if (throwing || covered) return null
  return (
    <div className="pp-font pointer-events-none absolute z-10 flex items-center" style={{ right: u(16), top: u(14), gap: u(10) }}>
      <span className="hidden sm:inline" style={{ fontSize: u(32) }}>
        <StrokeText stroke={u(7)}>{name}</StrokeText>
      </span>
      <div
        className="grid place-items-center overflow-hidden rounded-full"
        style={{ width: u(64), height: u(64), border: `${u(5)} solid #111`, background: GRADIENTS.blueButton, boxShadow: `0 ${u(4)} 0 #111` }}
      >
        {pfp ? (
          <img src={pfp} alt="" className="h-full w-full object-cover" />
        ) : (
          <span style={{ fontSize: u(36) }}>
            <StrokeText stroke={u(7)}>{name.charAt(0).toUpperCase()}</StrokeText>
          </span>
        )}
      </div>
    </div>
  )
}

export default AuthHUD
