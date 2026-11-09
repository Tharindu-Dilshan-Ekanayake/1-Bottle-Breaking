/**
 * Where Boxity lives, for this process. Every Boxity URL the server calls or allows is
 * built from here, never hard-coded, so one image runs against production or staging
 * just by what the platform injects (BLOXITY_ENV, BLOXITY_API_URL,
 * BLOXITY_MATCHMAKER_URL, BLOXITY_PORTAL_URL, BLOXITY_STATIC_URL). The production
 * defaults below apply only to a variable that is missing.
 */

const DEFAULTS = {
  env: 'prod',
  apiUrl: 'https://api.bloxity.io',
  matchmakerUrl: 'https://play.bloxity.io',
  portalUrl: 'https://bloxity.io',
  staticUrl: 'https://static.bloxity.io',
}

const GAME_FALLBACK = '1-bottle-breaking'

const trimUrl = (url) => String(url).replace(/\/+$/, '')

const hostOf = (url) => {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

/**
 * Reads the Boxity settings from `env` (process.env by default; tests pass their own).
 * `hosted` says whether this process runs on Boxity hosting (BLOXITY_ENV injected, or a
 * production build). Off it, the server trusts the ids clients claim, so development
 * works without a Boxity account.
 */
export function readBloxityEnv(env = process.env) {
  const pick = (name, fallback) => (env[name] ? trimUrl(env[name]) : fallback)
  const matchmakerUrl = pick('BLOXITY_MATCHMAKER_URL', DEFAULTS.matchmakerUrl)
  return {
    env: env.BLOXITY_ENV || DEFAULTS.env,
    apiUrl: pick('BLOXITY_API_URL', DEFAULTS.apiUrl),
    matchmakerUrl,
    portalUrl: pick('BLOXITY_PORTAL_URL', DEFAULTS.portalUrl),
    staticUrl: pick('BLOXITY_STATIC_URL', DEFAULTS.staticUrl),
    playHost: hostOf(matchmakerUrl),
    gameSlug: env.BLOXITY_GAME_SLUG || env.BLOXITY_GAME_ID || GAME_FALLBACK,
    gameId: env.BLOXITY_GAME_ID || GAME_FALLBACK,
    hosted: Boolean(env.BLOXITY_ENV) || env.NODE_ENV === 'production',
  }
}

export const bloxity = readBloxityEnv()

export const apiUrl = (path, settings = bloxity) => `${settings.apiUrl}${path}`
