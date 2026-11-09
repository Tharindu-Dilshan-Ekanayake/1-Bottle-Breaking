import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'

import { createProfile } from '../../shared/logic.js'
import { PlayerSession } from '../../shared/session.js'
import { asGuestId, resolveIdentity, verifyAdReward } from '../src/bloxityApi.js'
import { readBloxityEnv } from '../src/bloxityEnv.js'
import { BLOXITY_LEADERBOARDS, changedScores, chunk, leaderboardScores, sendScores } from '../src/bloxityLeaderboards.js'
import {
  carryOverGuest,
  claimGemGrant,
  closeStorage,
  loadProfile,
  openStorage,
  pendingGemGrants,
  recordGemGrant,
  releaseGemGrant,
  saveProfile,
  topPlayers,
} from '../src/db.js'
import { applyGemsFor, gemsWebhook, parseGemWebhook, profileIdOf, webhookSecretOk } from '../src/gems.js'
import { activePlayers } from '../src/registry.js'

/**
 * A stand-in for fetch: answers each call with `reply(url, init)` -> `{ status, body }`
 * (or throws, like a network failure), and remembers the calls.
 */
function fakeFetch(reply) {
  const calls = []
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) })
    const { status = 200, body = {} } = await reply(url, init)
    return { status, json: async () => body }
  }
  fn.calls = calls
  return fn
}

const hosted = readBloxityEnv({ BLOXITY_ENV: 'stage', BLOXITY_API_URL: 'https://api.stage.example/', BLOXITY_GAME_ID: 'tire' })
const local = readBloxityEnv({})

// --- Environment -----------------------------------------------------------------

test('Boxity URLs come from the environment, production only as the fallback', () => {
  assert.equal(local.env, 'prod')
  assert.equal(local.apiUrl, 'https://api.bloxity.io')
  assert.equal(local.matchmakerUrl, 'https://play.bloxity.io')
  assert.equal(local.portalUrl, 'https://bloxity.io')
  assert.equal(local.staticUrl, 'https://static.bloxity.io')
  assert.equal(local.gameSlug, '1-bottle-breaking')
  assert.equal(local.hosted, false)
  assert.equal(hosted.apiUrl, 'https://api.stage.example', 'trailing slash trimmed')
  assert.equal(hosted.gameSlug, 'tire')
  assert.equal(hosted.hosted, true)
  assert.equal(readBloxityEnv({ BLOXITY_GAME_SLUG: 's', BLOXITY_GAME_ID: 'g' }).gameSlug, 's')
  assert.equal(readBloxityEnv({ NODE_ENV: 'production' }).hosted, true)
  assert.equal(readBloxityEnv({ BLOXITY_MATCHMAKER_URL: 'https://play.stage.bloxity.io' }).playHost, 'play.stage.bloxity.io')
})

// --- Identity --------------------------------------------------------------------

test('a valid token makes the Boxity account id the save key', async () => {
  const fetchImpl = fakeFetch(() => ({ body: { valid: true, user: { _id: 'acc1', username: 'Real' }, carriedFrom: ['g1'] } }))
  const id = await resolveIdentity({ playerId: 'someone-else', token: 'tok', name: 'Fake' }, { fetchImpl, settings: hosted })
  assert.deepEqual(id, { playerId: 'acc1', verified: true, name: 'Real', carriedFrom: ['g1'] })
  const [call] = fetchImpl.calls
  assert.equal(call.url, 'https://api.stage.example/v1/auth/game-token/verify')
  assert.equal(call.init.headers.Authorization, 'Bearer tok')
  assert.deepEqual(call.body, { gameSlug: 'tire' })
})

test('a token Boxity rejects refuses the join', async () => {
  const fetchImpl = fakeFetch(() => ({ status: 401, body: { valid: false } }))
  await assert.rejects(resolveIdentity({ playerId: 'acc1', token: 'bad' }, { fetchImpl, settings: hosted }))
})

test('guests: their own guest id, anything else made into one when hosted', async () => {
  const fetchImpl = fakeFetch(() => assert.fail('no token, no call'))
  const opts = { fetchImpl, settings: hosted }
  assert.deepEqual(await resolveIdentity({ playerId: 'guest-abc' }, opts), { playerId: 'guest-abc', verified: false, carriedFrom: [] })
  assert.equal((await resolveIdentity({ playerId: 'acc1', token: null }, opts)).playerId, 'guest-acc1')
  assert.equal((await resolveIdentity({ playerId: 'acc1' }, { fetchImpl, settings: local })).playerId, 'acc1', 'any id off Boxity')
  await assert.rejects(resolveIdentity({}, opts))
  assert.equal(asGuestId('x'.repeat(200)).length, 80)
})

test('Boxity down: the player still gets in, as an unverified guest', async () => {
  const down = fakeFetch(() => {
    throw new Error('ECONNREFUSED')
  })
  const failing = fakeFetch(() => ({ status: 503, body: null }))
  for (const fetchImpl of [down, failing]) {
    const id = await resolveIdentity({ playerId: 'acc1', token: 'tok' }, { fetchImpl, settings: hosted })
    assert.deepEqual(id, { playerId: 'guest-acc1', verified: false, carriedFrom: [] })
  }
})

test('an ad pays only when Boxity says the token is valid', async () => {
  const yes = fakeFetch(() => ({ body: { valid: true } }))
  assert.equal(await verifyAdReward('r1', { fetchImpl: yes, settings: hosted }), true)
  assert.equal(yes.calls[0].url, 'https://api.stage.example/v1/ads/reward/verify')
  assert.deepEqual(yes.calls[0].body, { gameSlug: 'tire', rewardToken: 'r1' })
  assert.equal(await verifyAdReward('r1', { fetchImpl: fakeFetch(() => ({ body: { valid: 'true' } })), settings: hosted }), false)
  const down = fakeFetch(() => {
    throw new Error('timeout')
  })
  assert.equal(await verifyAdReward('r1', { fetchImpl: down, settings: hosted }), false)
})

// --- Leaderboards ----------------------------------------------------------------

test('leaderboard scores are whole numbers from the profile', () => {
  const p = createProfile('a', 'A')
  Object.assign(p, { rebirths: 3 })
  Object.assign(p.stats, { totalWins: 1234.6, bestStairs: 569.9, playtime: 3599 })
  assert.deepEqual(leaderboardScores(p), { rebirths: 3, wins: 1234, stairs: 569, playtime: 59 })
  assert.deepEqual(
    BLOXITY_LEADERBOARDS.map((b) => b.id),
    Object.keys(leaderboardScores(p)),
  )
})

test('only changed scores are reported, as legion_<id>', () => {
  const p = createProfile('a', 'A')
  p.rebirths = 2
  const lastSent = new Map([
    ['legion_a|rebirths', 2],
    ['legion_a|wins', 0],
    ['legion_a|stairs', 0],
  ])
  assert.deepEqual(changedScores([{ id: 'a', profile: p }], lastSent), [{ board: 'playtime', userId: 'legion_a', score: 0 }])
  assert.deepEqual(
    chunk([1, 2, 3, 4, 5], 2),
    [[1, 2], [3, 4], [5]],
  )
})

test('reports go in batches of 200; failed batches are retried later', async () => {
  const scores = Array.from({ length: 450 }, (_, i) => ({ board: 'wins', userId: `legion_${i}`, score: i }))
  let n = 0
  const fetchImpl = fakeFetch(() => {
    n += 1
    return n === 2 ? { status: 500 } : { body: { accepted: 1, dropped: { wins: 0 } } }
  })
  const lastSent = new Map()
  await sendScores(scores, lastSent, { token: 'rt', settings: hosted, fetchImpl })
  assert.deepEqual(
    fetchImpl.calls.map((c) => c.body.scores.length),
    [200, 200, 50],
  )
  assert.equal(fetchImpl.calls[0].url, 'https://api.stage.example/v1/leaderboards/hosted/tire/report')
  assert.equal(fetchImpl.calls[0].init.headers.Authorization, 'Bearer rt')
  assert.deepEqual(fetchImpl.calls[0].body.boards, BLOXITY_LEADERBOARDS)
  assert.equal(lastSent.size, 250, 'the failed batch is not marked as sent')
  assert.equal(lastSent.has('legion_250|wins'), false)
})

// --- Gems webhook ----------------------------------------------------------------

test('the webhook secret must match exactly when one is set', () => {
  assert.equal(webhookSecretOk(undefined, ''), true)
  assert.equal(webhookSecretOk('s3cret', 's3cret'), true)
  assert.equal(webhookSecretOk('s3cre', 's3cret'), false)
  assert.equal(webhookSecretOk(undefined, 's3cret'), false)
})

test('webhook bodies are checked: known sku, ids, legion_ prefix stripped', () => {
  const ok = parseGemWebhook({ transactionId: 't1', userId: 'legion_acc1', sku: 'wins_small', productPrice: 50 })
  assert.equal(ok.ok, true)
  assert.equal(ok.grant.userId, 'acc1')
  assert.equal(profileIdOf('acc2'), 'acc2')
  assert.equal(parseGemWebhook({ transactionId: 't1', userId: 'acc1', sku: 'nope' }).status, 400)
  assert.equal(parseGemWebhook({ userId: 'acc1', sku: 'wins_small' }).status, 400)
  assert.equal(parseGemWebhook(null).ok, false)
})

// --- Database (SQLite in memory) -------------------------------------------------

before(() => openStorage({ path: ':memory:' }))
after(() => closeStorage())

test('a Gems grant is recorded once and claimed once', async () => {
  const grant = { transactionId: 'txn-1', userId: 'acc1', sku: 'wins_small' }
  assert.equal(await recordGemGrant(grant), true)
  assert.equal(await recordGemGrant(grant), false, 'a repeated webhook is a no-op')
  assert.deepEqual(await pendingGemGrants(['acc1', 'other']), [grant])
  assert.equal(await claimGemGrant('txn-1', 'pod-a'), true)
  assert.equal(await claimGemGrant('txn-1', 'pod-b'), false)
  assert.deepEqual(await pendingGemGrants(['acc1']), [])
  await releaseGemGrant('txn-1', 'pod-b')
  assert.deepEqual(await pendingGemGrants(['acc1']), [], 'only the claimer can release')
  await releaseGemGrant('txn-1', 'pod-a')
  assert.equal(await claimGemGrant('txn-1', 'pod-b'), true)
})

test('the webhook route records grants and answers fast', async () => {
  const call = async (body, secret) => {
    const res = { code: 200, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
    await gemsWebhook({ body, get: () => secret }, res)
    return res.code
  }
  process.env.LEGION_WEBHOOK_SECRET = 'hook'
  try {
    const body = { transactionId: 'txn-w', userId: 'legion_acc9', sku: 'wins_x2' }
    assert.equal(await call(body, 'wrong'), 401)
    assert.equal(await call(body, 'hook'), 200)
    assert.equal(await call(body, 'hook'), 200, 'duplicates are fine')
    assert.equal(await call({ ...body, transactionId: 'txn-x', sku: 'nope' }, 'hook'), 400)
    assert.deepEqual(await pendingGemGrants(['acc9']), [{ transactionId: 'txn-w', userId: 'acc9', sku: 'wins_x2' }])
  } finally {
    delete process.env.LEGION_WEBHOOK_SECRET
  }
})

test('a pod applies grants to the verified players it holds, exactly once', async () => {
  const profile = createProfile('acc5', 'Five')
  const session = new PlayerSession(profile, { now: 0, emit: () => {}, getPosition: () => ({ x: 0, z: 0 }) })
  const member = { session, playerId: 'acc5', verified: true, owner: 'test' }
  const room = { members: new Map([['s5', member]]), syncPlayer: () => {} }
  activePlayers.set('acc5', { room, client: { sessionId: 's5' } })
  try {
    await recordGemGrant({ transactionId: 'txn-5', userId: 'acc5', sku: 'power_x2' })
    await Promise.all([applyGemsFor(['acc5']), applyGemsFor(['acc5'])])
    assert.deepEqual(profile.passes, ['powerX2'])
    assert.equal(profile.wins, 0, 'applied once, not turned into Wins by a second copy')
    assert.deepEqual((await loadProfile('acc5', 'Five', 'test')).passes, ['powerX2'], 'saved')
    assert.deepEqual(await pendingGemGrants(['acc5']), [])
  } finally {
    activePlayers.delete('acc5')
  }
})

test('guest progress carries into a new account once', async () => {
  const guest = createProfile('guest-g1', 'Guesty')
  guest.wins = 777
  guest.rebirths = 2
  await saveProfile(guest, 'x')
  assert.equal(await carryOverGuest('acc7', ['nope', 'g1'], 'Seven'), 'guest-g1', 'found under its guest- spelling')
  const carried = await loadProfile('acc7', 'Seven', 'x')
  assert.equal(carried.id, 'acc7')
  assert.equal(carried.name, 'Seven')
  assert.equal(carried.wins, 777)
  assert.equal(carried.rebirths, 2)
  assert.equal(await carryOverGuest('acc8', ['guest-g1'], 'Eight'), null, 'never copied twice')
  assert.equal(await carryOverGuest('acc7', ['guest-g1'], 'Seven'), null)
  const boards = await topPlayers(10)
  assert.equal(boards.rebirths.filter((r) => r.value === 2).length, 1, 'the used guest save is off the boards')

  // An account that already has progress keeps it.
  const other = createProfile('guest-g2', 'G2')
  other.wins = 5
  await saveProfile(other, 'x')
  assert.equal(await carryOverGuest('acc7', ['guest-g2'], 'Seven'), null)
  assert.equal(await carryOverGuest('acc10', ['guest-g2'], 'Ten'), 'guest-g2', 'still unused, so still available')
})

// --- Open Rooms reporter -----------------------------------------------------------

test('the room reporter posts this pod\'s rooms to Boxity, and only when configured', async () => {
  const { installRoomReporter } = await import('../src/legionRoomReporter.js')
  const realFetch = globalThis.fetch
  const saved = { ...process.env }
  const calls = []
  const query = async () => [
    { roomId: 'abc', name: 'game', clients: 3, maxClients: 8, locked: false, private: false, metadata: { players: 3 } },
    { roomId: 'XYZ12', name: 'game', clients: 1, maxClients: 8, locked: false, private: true, metadata: {} },
  ]
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return { ok: true }
  }
  try {
    delete process.env.MATCHMAKER_REPORT_URL
    installRoomReporter({ query })()
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(calls.length, 0, 'nothing without the platform variables')

    Object.assign(process.env, { MATCHMAKER_REPORT_URL: 'https://mm.test/report/', BLOXITY_REPORT_TOKEN: 'tok', BLOXITY_GAME_ID: 'tire', POD_NAME: 'pod-1' })
    const stop = installRoomReporter({ intervalMs: 60000, query })
    await new Promise((r) => setTimeout(r, 10))
    stop()
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://mm.test/report/tire/rooms')
    assert.equal(calls[0].init.headers.authorization, 'Bearer tok')
    const body = JSON.parse(calls[0].init.body)
    assert.equal(body.podName, 'pod-1')
    assert.equal(body.players, 4)
    assert.deepEqual(body.rooms[0], { colyseusRoomId: 'abc', name: 'game', clients: 3, maxClients: 8, locked: false, private: false, started: false, metadata: { players: 3 } })
    assert.equal(body.rooms[1].private, true)
  } finally {
    globalThis.fetch = realFetch
    process.env = saved
  }
})
