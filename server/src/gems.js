import { timingSafeEqual } from 'node:crypto'

import { GEM_PRODUCTS } from '../../shared/balance.js'
import { bloxity } from './bloxityEnv.js'
import { claimGemGrant, pendingGemGrants, recordGemGrant, releaseGemGrant, saveProfile } from './db.js'
import { activePlayers, liveRooms } from './registry.js'

/**
 * Boxity Gems purchases.
 *
 * Boxity confirms a sale with a server-to-server webhook, which the platform may route
 * to any pod - usually not the one the buyer plays on. So the webhook only records the
 * grant in the shared database and answers at once (a non-2xx answer makes Boxity
 * refund the player). Each pod then applies the grants of the players it holds: when
 * they join, every POLL_MS, and when their client asks ('gemsCheck', sent after the
 * SDK reports a purchase). Each grant is claimed atomically before it's applied, so it
 * lands exactly once.
 */

const POLL_MS = 5000
/** Names this process in claims; Legion sets POD_NAME per pod. */
const POD = process.env.POD_NAME || `local-${process.pid}`

/**
 * Whether the webhook's `x-legion-webhook-secret` header matches LEGION_WEBHOOK_SECRET.
 * With no secret configured every call is accepted (local testing).
 */
export function webhookSecretOk(header, secret = process.env.LEGION_WEBHOOK_SECRET) {
  if (!secret) return true
  if (typeof header !== 'string') return false
  const a = Buffer.from(header)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Boxity sends account ids as 'legion_<id>'; profiles are keyed by the bare id. */
export const profileIdOf = (userId) => String(userId || '').replace(/^legion_/, '')

/**
 * Checks a webhook body. Resolves `{ ok: true, grant }` with the record to store, or
 * `{ ok: false, status, error }`.
 */
export function parseGemWebhook(body) {
  if (!body || typeof body !== 'object') return { ok: false, status: 400, error: 'Expected a JSON body' }
  const transactionId = typeof body.transactionId === 'string' || typeof body.transactionId === 'number' ? String(body.transactionId) : ''
  const userId = profileIdOf(body.userId)
  if (!transactionId || !userId) return { ok: false, status: 400, error: 'transactionId and userId are required' }
  // An unknown sku can't be granted: refuse it, so Boxity refunds the player.
  if (!GEM_PRODUCTS[body.sku]) return { ok: false, status: 400, error: `Unknown sku ${body.sku}` }
  return {
    ok: true,
    grant: {
      transactionId,
      userId,
      sku: body.sku,
      username: body.username ?? null,
      productName: body.productName ?? null,
      productPrice: body.productPrice ?? null,
      metadata: body.metadata ?? null,
      timestamp: body.timestamp ?? null,
      gameSlug: body.gameSlug ?? null,
    },
  }
}

/** Express handler for POST /api/gems/webhook. */
export async function gemsWebhook(req, res) {
  if (!webhookSecretOk(req.get('x-legion-webhook-secret'))) return res.status(401).json({ error: 'Bad webhook secret' })
  const parsed = parseGemWebhook(req.body)
  if (!parsed.ok) {
    console.warn(`[gems] webhook refused: ${parsed.error}`)
    return res.status(parsed.status).json({ error: parsed.error })
  }
  const { grant } = parsed
  if (grant.gameSlug && grant.gameSlug !== bloxity.gameSlug) {
    console.warn(`[gems] webhook for game ${grant.gameSlug}, this is ${bloxity.gameSlug}; recording it anyway`)
  }
  try {
    const fresh = await recordGemGrant(grant)
    console.log(`[gems] ${fresh ? 'recorded' : 'duplicate'} ${grant.transactionId}: ${grant.sku} for ${grant.userId}`)
  } catch (err) {
    // Not recorded, so not deliverable: let Boxity refund rather than keep the Gems.
    console.error('[gems] could not record grant', err)
    return res.status(500).json({ error: 'Could not record the purchase' })
  }
  res.json({ ok: true })
  // The buyer may well be right here: no need to wait for the next poll.
  if (activePlayers.has(grant.userId)) applyGemsFor([grant.userId]).catch(() => {})
}

/** Players who may receive Gems: verified accounts (anyone, off Boxity hosting). */
const eligible = (member) => member && !member.kicked && (member.verified || !bloxity.hosted)

/**
 * Applies every unapplied grant for `playerIds` that this pod holds. Never throws.
 */
export async function applyGemsFor(playerIds) {
  const held = playerIds.filter((id) => {
    const entry = activePlayers.get(id)
    return entry && eligible(entry.room.members.get(entry.client.sessionId))
  })
  if (!held.length) return
  let grants
  try {
    grants = await pendingGemGrants(held)
  } catch (err) {
    console.error('[gems] could not read pending grants', err)
    return
  }
  for (const grant of grants) {
    try {
      if (!(await claimGemGrant(grant.transactionId, POD))) continue
      // Read the player again after the wait: they may have left meanwhile.
      const entry = activePlayers.get(grant.userId)
      const member = entry?.room.members.get(entry.client.sessionId)
      if (!eligible(member)) {
        await releaseGemGrant(grant.transactionId, POD)
        continue
      }
      const result = member.session.grantGemProduct(grant.sku)
      if (!result.ok) console.warn(`[gems] ${grant.transactionId}: ${result.error}`)
      entry.room.syncPlayer(entry.client.sessionId)
      console.log(`[gems] applied ${grant.transactionId}: ${grant.sku} to ${grant.userId}`)
      await saveProfile(member.session.profile, member.owner)
    } catch (err) {
      console.error(`[gems] applying ${grant.transactionId} failed`, err)
    }
  }
}

/** Applies grants for one member of `room`, by session id (join, 'gemsCheck'). */
export function applyGemsForSession(room, sessionId) {
  const member = room.members.get(sessionId)
  if (member) applyGemsFor([member.playerId]).catch(() => {})
}

/** Every POLL_MS, applies grants for everyone on this pod. */
export function startGemsPoller() {
  let busy = false
  const id = setInterval(async () => {
    if (busy || liveRooms.size === 0) return
    busy = true
    try {
      await applyGemsFor([...activePlayers.keys()])
    } finally {
      busy = false
    }
  }, POLL_MS)
  return () => clearInterval(id)
}
