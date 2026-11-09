import { useBloxity } from '../bloxity/BloxityContext'

/**
 * Corner HUD.
 *
 * Uses the `getUser() || getGuest()` pattern (surfaced as `identity` on the context)
 * so there is always a name and picture to show, even before the player logs in.
 */
export function AuthHUD() {
  const { identity, isLoggedIn, login, logout, status, error } = useBloxity()

  const name = identity?.displayName || identity?.username || 'Guest'
  const pfp = identity?.pfp

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-xl bg-black/50 px-3 py-2 text-white backdrop-blur">
        {pfp ? (
          <img
            src={pfp}
            alt=""
            className="h-9 w-9 rounded-full object-cover ring-2 ring-white/30"
          />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-sm font-semibold">
            {name.charAt(0).toUpperCase()}
          </div>
        )}

        <div className="leading-tight">
          <div className="text-sm font-semibold">{name}</div>
          <div className="text-xs text-white/60">
            {isLoggedIn ? 'Signed in with Bloxity' : 'Playing as guest'}
          </div>
        </div>
      </div>

      <div className="pointer-events-auto flex flex-col items-end gap-2">
        {isLoggedIn ? (
          <button
            type="button"
            onClick={logout}
            className="rounded-lg bg-white/10 px-3 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/20"
          >
            Log out
          </button>
        ) : (
          <button
            type="button"
            onClick={login}
            disabled={status !== 'ready'}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-lg transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === 'ready' ? 'Log in with Bloxity' : 'Connecting…'}
          </button>
        )}

        {status === 'error' && (
          <div className="max-w-xs rounded-lg bg-red-600/80 px-3 py-2 text-xs text-white">
            Bloxity SDK failed to load. {error?.message}
          </div>
        )}
      </div>
    </div>
  )
}

export default AuthHUD
