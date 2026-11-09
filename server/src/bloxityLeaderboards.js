import { apiUrl, bloxity } from './bloxityEnv.js'
import { postJson } from './bloxityApi.js'
import { activePlayers } from './registry.js'
import { LEADERBOARDS } from '../../shared/balance.js'
import { leaderboardScores } from '../../shared/logic.js'

/**
 * Boxity leaderboards, reported by the server: it owns the numbers, so a client can't
 * post a score it didn't earn.
 *
 * Every REPORT_MS, and when a player leaves, the scores of this pod's verified players
 * go to Boxity in one batch - only those that changed since Boxity last took them.
 * Each pod reports its own players; together they cover everyone. Without
 * BLOXITY_REPORT_TOKEN nothing is reported (a laptop, or before the platform issued
 * one).
 */

const REPORT_MS = 20_000
/** Boxity takes at most this many scores per call. */
export const MAX_SCORES_PER_REPORT = 200

/** The boards (shared with the client, which declares them through the SDK). */
export const BLOXITY_LEADERBOARDS = LEADERBOARDS

/** A profile's score on each board (shared/logic.js). */
export { leaderboardScores }

/** Boxity knows a game's players as 'legion_' + their account id. */
export const boxityUserId = (playerId) => `legion_${playerId}`

/**
 * The scores to report for `players` (`[{ id, profile }]`): every board whose score
 * differs from what `lastSent` (`'userId|board' -> score`) says Boxity has.
 */
export function changedScores(players, lastSent) {
  const scores = []
  for (const { id, profile } of players) {
    const userId = boxityUserId(id)
    for (const [board, score] of Object.entries(leaderboardScores(profile))) {
      if (lastSent.get(`${userId}|${board}`) !== score) scores.push({ board, userId, score })
    }
  }
  return scores
}

/** `list` in pieces of at most `size`. */
export function chunk(list, size = MAX_SCORES_PER_REPORT) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/**
 * Sends `scores` to Boxity in calls of at most 200. Every score Boxity took goes into
 * `lastSent`; a failed call leaves its scores out, so they are tried again next time.
 */
export async function sendScores(scores, lastSent, { token, settings = bloxity, fetchImpl = fetch } = {}) {
  const url = apiUrl(`/v1/leaderboards/hosted/${encodeURIComponent(settings.gameId)}/report`, settings)
  for (const batch of chunk(scores)) {
    try {
      const { status, body } = await postJson(
        url,
        { boards: BLOXITY_LEADERBOARDS, scores: batch },
        { headers: { Authorization: `Bearer ${token}` }, fetchImpl },
      )
      if (status < 200 || status >= 300) {
        console.warn(`[boxity-boards] report refused (${status})`, body?.error || '')
        continue
      }
      for (const s of batch) lastSent.set(`${s.userId}|${s.board}`, s.score)
      const dropped = body?.dropped
      if (dropped && (typeof dropped !== 'object' || Object.values(dropped).some(Boolean))) {
        console.warn('[boxity-boards] dropped', JSON.stringify(dropped))
      }
    } catch (err) {
      console.warn('[boxity-boards] report failed', err?.message || err)
    }
  }
}

// --- This pod's reporter -------------------------------------------------------------

/** 'userId|board' -> the score Boxity last accepted from this pod. */
const lastSent = new Map()
/** playerId -> profile of verified players who left, until their last scores are in. */
const leavers = new Map()
let running = null
let again = false

/** This pod's verified players right now, as `[{ id, profile }]`. */
function presentPlayers() {
  const out = []
  for (const [id, { room, client }] of activePlayers) {
    const member = room.members.get(client.sessionId)
    if (member?.verified && !member.kicked) out.push({ id, profile: member.session.profile })
  }
  return out
}

async function report(token) {
  // Back already: their new session reports for them.
  for (const id of leavers.keys()) if (activePlayers.has(id)) leavers.delete(id)
  const players = [...presentPlayers(), ...[...leavers].map(([id, profile]) => ({ id, profile }))]
  const scores = changedScores(players, lastSent)
  if (scores.length) await sendScores(scores, lastSent, { token })
  // Leavers whose scores are all in are done; forget them so this map stays small.
  for (const [id, profile] of leavers) {
    if (changedScores([{ id, profile }], lastSent).length) continue
    leavers.delete(id)
    if (!activePlayers.has(id)) for (const board of BLOXITY_LEADERBOARDS) lastSent.delete(`${boxityUserId(id)}|${board.id}`)
  }
}

/** Runs a report, or queues one right after the one in flight. */
function flush() {
  const token = process.env.BLOXITY_REPORT_TOKEN
  if (!token) return
  if (running) {
    again = true
    return
  }
  running = report(token).finally(() => {
    running = null
    if (again) {
      again = false
      flush()
    }
  })
}

/** A verified player left: report their final scores now rather than never. */
export function reportLeaver(playerId, profile) {
  if (!process.env.BLOXITY_REPORT_TOKEN) return
  leavers.set(playerId, profile)
  flush()
}

export function startBloxityLeaderboards() {
  if (!process.env.BLOXITY_REPORT_TOKEN) {
    console.log('[boxity-boards] BLOXITY_REPORT_TOKEN not set; not reporting scores')
    return () => {}
  }
  const id = setInterval(flush, REPORT_MS)
  return () => clearInterval(id)
}
