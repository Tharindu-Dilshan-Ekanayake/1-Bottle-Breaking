/**
 * Procedural sound effects and music (WebAudio). No audio files are shipped.
 *
 * Browsers refuse to start audio before a user gesture, so the AudioContext is not
 * created until the first tap / click / key press (`installAudioUnlock`). Every sfx call
 * before that is a silent no-op, and the music starts only then.
 */

let ctx = null
let master = null
let sfxBus = null
let musicBus = null
let noise = null
let muted = false
let musicWanted = true
let lastBounce = 0
let lastStep = 0
let lastHover = 0
/** Boxity's master_volume / music_volume settings, 0..1. */
let masterVolume = 1
let musicVolume = 1
/** Silenced for a Boxity ad break (on top of, never instead of, the player's mute). */
let adMuted = false
/** The music dips under a throw so the bottle can be heard (1 = not ducked). */
let musicDuck = 1
const MUSIC_DUCK = 0.6

const masterLevel = () => (muted || adMuted ? 0 : 0.7 * masterVolume)
const musicLevel = () => 0.55 * musicVolume * musicDuck

/** `?perf` only: how often each throw sound ran, for automated checks (like PerfProbe). */
const stats =
  typeof window !== 'undefined' && /[?&]perf\b/.test(window.location.search)
    ? (window.__btAudio = { rollStart: 0, rollVoice: 0, rollUpdate: 0, rollStop: 0, bounce: 0, shatter: 0, shower: 0 })
    : null

function applyMaster() {
  if (master && ctx) master.gain.setTargetAtTime(masterLevel(), ctx.currentTime, 0.05)
}

export function setMuted(value) {
  muted = value
  applyMaster()
}

/** Master volume 0..1 (Boxity's master_volume setting). */
export function setMasterVolume(volume) {
  masterVolume = Math.min(1, Math.max(0, Number(volume) || 0))
  applyMaster()
}

/** Music volume 0..1 (Boxity's music_volume setting), under the master volume. */
export function setMusicVolume(volume) {
  musicVolume = Math.min(1, Math.max(0, Number(volume) || 0))
  if (ctx && musicBus && musicTimer) musicBus.gain.setTargetAtTime(musicLevel(), ctx.currentTime, 0.2)
}

/** Ducks the music under a throw (`on`), or brings it back after `delay` seconds. */
function duckMusic(on, delay = 0) {
  const duck = on ? MUSIC_DUCK : 1
  if (duck === musicDuck) return
  musicDuck = duck
  if (ctx && musicBus && musicTimer && musicWanted) {
    musicBus.gain.setTargetAtTime(musicLevel(), ctx.currentTime + delay, on ? 0.15 : 0.6)
  }
}

/**
 * Silences everything for a Boxity ad break and suspends the audio clock, so the music
 * scheduler doesn't pile notes up behind it. Ending the break restores the player's own
 * mute and volumes exactly as they were.
 */
export function setAdBreakMuted(on) {
  adMuted = Boolean(on)
  applyMaster()
  if (!ctx) return
  if (adMuted) ctx.suspend()
  else if (ctx.state === 'suspended' && document.visibilityState === 'visible') ctx.resume()
}

/**
 * The last stage before the speakers: clean below 0.75, rounding off smoothly to never
 * exceed 1 - so a smash on top of a bounce saturates gently instead of clipping hard
 * (the compressor's 3 ms attack lets the very first transient through).
 */
function makeSoftClip(context, destination) {
  const range = 4
  const pre = context.createGain()
  pre.gain.value = 1 / range
  const shaper = context.createWaveShaper()
  const n = 2048
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i += 1) {
    const v = ((i / (n - 1)) * 2 - 1) * range
    const a = Math.abs(v)
    curve[i] = a < 0.75 ? v : Math.sign(v) * (0.75 + 0.25 * Math.tanh((a - 0.75) / 0.25))
  }
  shaper.curve = curve
  pre.connect(shaper).connect(destination)
  return pre
}

function makeNoiseBuffer(context) {
  const length = Math.floor(context.sampleRate * 0.8)
  const buffer = context.createBuffer(1, length, context.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1
  return buffer
}

/**
 * The rolling texture and the shard shower are computed once, when the browser is idle
 * after the first tap - never in the middle of a throw.
 */
function prepareBuffers() {
  const idle = typeof window.requestIdleCallback === 'function' ? (fn) => window.requestIdleCallback(fn, { timeout: 2500 }) : (fn) => setTimeout(fn, 400)
  idle(() => {
    try {
      if (ctx && !crackleBuffer) crackleBuffer = makeCrackleBuffer(ctx)
    } catch {
      /* built on first use instead */
    }
    idle(() => {
      try {
        if (ctx && !shardBuffer) shardBuffer = makeShardBuffer(ctx)
      } catch {
        /* the shatter falls back to synthesised tinkles */
      }
    })
  })
}

export function installAudioUnlock() {
  const events = ['pointerdown', 'touchend', 'keydown']
  const unlock = () => {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext
        if (!AC) return
        ctx = new AC()
        master = ctx.createGain()
        master.gain.value = masterLevel()
        master.connect(makeSoftClip(ctx, ctx.destination))
        // A gentle compressor keeps stacked bounces from clipping.
        const comp = ctx.createDynamicsCompressor()
        comp.threshold.value = -14
        comp.ratio.value = 4
        comp.connect(master)
        sfxBus = ctx.createGain()
        sfxBus.gain.value = 0.9
        sfxBus.connect(comp)
        musicBus = ctx.createGain()
        musicBus.gain.value = 0
        musicBus.connect(comp)
        noise = makeNoiseBuffer(ctx)
        prepareBuffers()
      }
      if (ctx.state === 'suspended') ctx.resume()
      if (ctx.state !== 'suspended') {
        events.forEach((e) => window.removeEventListener(e, unlock))
        if (musicWanted) startMusic()
      }
    } catch {
      /* audio unavailable; play silently */
    }
  }
  events.forEach((e) => window.addEventListener(e, unlock, { passive: true }))
}

const ready = () => ctx && !muted && !adMuted && ctx.state === 'running'

function tone({ freq, to = freq, type = 'sine', dur = 0.12, vol = 0.25, delay = 0, attack = 0.008, bus = sfxBus }) {
  const t = ctx.currentTime + delay
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(vol, t + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(gain).connect(bus)
  osc.start(t)
  osc.stop(t + dur + 0.03)
}

function burst({ dur = 0.3, vol = 0.4, freq = 3000, q = 0.8, delay = 0, type = 'bandpass', sweepTo = null, attack = 0.01, bus = sfxBus }) {
  const t = ctx.currentTime + delay
  const src = ctx.createBufferSource()
  src.buffer = noise
  const filter = ctx.createBiquadFilter()
  filter.type = type
  filter.frequency.setValueAtTime(freq, t)
  if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + dur)
  filter.Q.value = q
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(vol, t + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(filter).connect(gain).connect(bus)
  src.start(t, Math.random() * 0.3)
  src.stop(t + dur + 0.03)
}

/** A stereo panner into the sfx bus for one sound (or the bus itself where unsupported). */
function pannedBus(pan) {
  if (!ctx.createStereoPanner || !pan) return sfxBus
  const p = ctx.createStereoPanner()
  p.pan.value = Math.max(-1, Math.min(1, pan))
  p.connect(sfxBus)
  // Freed with the sounds that feed it.
  setTimeout(() => p.disconnect(), 3000)
  return p
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo))
const clamp01 = (v) => clamp(Number(v) || 0, 0, 1)

/* ---------------------------------------------------------- Glass, synthesised */

/*
 * The rolling bottle is a source-filter model (as in physical sound design): the bottle
 * itself is a small bank of resonators - a glass shell ringing at inharmonic partials
 * (the 1 : 2.8 : 5.4 : 8.8 series of a ringing cylinder), a duller "clonk" body mode and
 * the hollow air cavity - and everything that touches it excites that same bank:
 *
 *  - the stone surface: a looped crackle of tiny grains, played faster as it speeds up,
 *    swelling and thinning once per turn (the bottle is never perfectly round);
 *  - the seam / shoulder knocking the step once per revolution;
 *  - the gel balls inside: little clusters of soft clicks every half turn, a flurry after
 *    each landing;
 *  - each landing (`bounce`): a hard knock that makes the glass ring;
 *  - and the liquid: an occasional bubble blip as it sloshes.
 *
 * Events are scheduled a few tens of ms ahead from a timer (never the render loop) as
 * automation on a fixed set of nodes, so a throw builds ~40 nodes once and creates none
 * while it rolls.
 */

/** How each bottle family's glass sounds: `pitch` scales the partials, `ring` their decay. */
const GLASS = {
  classic: { pitch: 1, ring: 1 },
  soda: { pitch: 1.08, ring: 0.85 },
  jar: { pitch: 0.8, ring: 0.75 },
  potion: { pitch: 0.95, ring: 1.1 },
  flask: { pitch: 1.12, ring: 1.25 },
  gourd: { pitch: 0.9, ring: 1.05 },
  crystal: { pitch: 1.3, ring: 1.6 },
}
/** Shell partials: frequency ratio, decay time constant (s), level. */
const SHELL = [
  [1, 0.11, 1],
  [2.76, 0.065, 0.65],
  [5.22, 0.04, 0.4],
  [8.6, 0.02, 0.12],
]
const SHELL_HZ = 1150
/** Overall gain of the resonator bank (a narrow resonator passes little of a short burst). */
const BANK_GAIN = 60

let crackleBuffer = null
const CRACKLE_SECONDS = 2.5

/**
 * The stone under a rolling bottle: a continuous fine grit plus ~1,900 grains a second
 * with heavy-tailed sizes, through a slowly wandering roughness. High-passed (no DC) and
 * cross-faded at the seam so it loops cleanly.
 */
function makeCrackleBuffer(context) {
  const rate = context.sampleRate
  const n = Math.floor(rate * CRACKLE_SECONDS)
  const buffer = context.createBuffer(1, n, rate)
  const d = buffer.getChannelData(0)
  const grain = 1900 / rate
  let rough = 0.7
  let target = 0.7
  let hp = 0
  let prev = 0
  for (let i = 0; i < n; i += 1) {
    if (i % 220 === 0) target = 0.3 + Math.random() * 0.7
    rough += (target - rough) * 0.004
    let x = (Math.random() * 2 - 1) * 0.06
    if (Math.random() < grain) {
      const r = Math.random()
      x += (Math.random() < 0.5 ? -1 : 1) * (0.12 + r * r * r * 0.88)
    }
    x *= rough
    hp = x - prev + 0.995 * hp
    prev = x
    d[i] = hp
  }
  const fade = Math.floor(rate * 0.02)
  for (let k = 0; k < fade; k += 1) {
    const w = k / fade
    d[n - fade + k] = d[n - fade + k] * (1 - w) + d[k] * w
  }
  let peak = 0
  for (let i = 0; i < n; i += 1) peak = Math.max(peak, Math.abs(d[i]))
  if (peak > 0) for (let i = 0; i < n; i += 1) d[i] *= 0.95 / peak
  return buffer
}

let shardBuffer = null

/**
 * The shard shower after the smash (stereo, 2 s): a dense bright cluster at the break, a
 * spray of tinkles thinning out over ~0.8 s, then shards landing on the stairs below -
 * each bouncing two to four times, quicker and quieter each time. Every tinkle is a few
 * inharmonic partials with a tiny contact click, synthesised with a decaying rotation
 * (no sin() per sample).
 */
function makeShardBuffer(context) {
  const rate = context.sampleRate
  const n = Math.floor(rate * 2)
  const buffer = context.createBuffer(2, n, rate)
  const L = buffer.getChannelData(0)
  const R = buffer.getChannelData(1)
  const rnd = Math.random
  const ping = (t0, f, amp, tau, pan, partials) => {
    const start = Math.floor(t0 * rate)
    if (start >= n) return
    const gl = Math.cos(((pan + 1) * Math.PI) / 4)
    const gr = Math.sin(((pan + 1) * Math.PI) / 4)
    for (let k = 0; k < 20 && start + k < n; k += 1) {
      const c = (rnd() * 2 - 1) * amp * 0.45 * (1 - k / 20)
      L[start + k] += c * gl
      R[start + k] += c * gr
    }
    for (let p = 0; p < partials; p += 1) {
      const ratio = p === 0 ? 1 : p === 1 ? 2.6 + rnd() * 0.4 : 4.9 + rnd() * 0.8
      const fp = f * ratio
      if (fp > rate * 0.45) break
      const a = amp * (p === 0 ? 1 : p === 1 ? 0.5 : 0.28)
      const tp = tau / Math.pow(ratio, 0.6)
      const len = Math.min(n - start, Math.floor(tp * 6 * rate))
      const w = (2 * Math.PI * fp) / rate
      const cw = Math.cos(w)
      const sw = Math.sin(w)
      const dec = Math.exp(-1 / (tp * rate))
      const ph = rnd() * Math.PI * 2
      let re = Math.cos(ph)
      let im = Math.sin(ph)
      for (let k = 0; k < len; k += 1) {
        const v = im * a
        L[start + k] += v * gl
        R[start + k] += v * gr
        const nr = (re * cw - im * sw) * dec
        im = (re * sw + im * cw) * dec
        re = nr
      }
    }
  }
  // The break: dense and bright.
  for (let i = 0; i < 34; i += 1) {
    const r = rnd()
    ping(0.002 + 0.09 * r * r, 3000 + rnd() * 8000, 0.5 * (0.4 + 0.6 * rnd()), 0.008 + rnd() * 0.03, rnd() * 1.6 - 0.8, 3)
  }
  // The spray, thinning out.
  for (let i = 0; i < 42; i += 1) {
    const r = rnd()
    ping(0.05 + 0.75 * r * r, 2500 + rnd() * 7000, 0.32 * (1 - r * 0.7) * (0.4 + 0.6 * rnd()), 0.012 + rnd() * 0.05, rnd() * 1.8 - 0.9, 3)
  }
  // Shards landing on the steps: tik.. tik. tik, each quicker and quieter.
  for (let s = 0; s < 14; s += 1) {
    let t = 0.28 + rnd() * 1.0
    let amp = 0.22 * (1 - (t - 0.28) / 1.3) * (0.5 + 0.5 * rnd())
    const f = 2800 + rnd() * 6000
    const pan = rnd() * 2 - 1
    let gap = 0.07 + rnd() * 0.12
    const hops = 2 + Math.floor(rnd() * 3)
    for (let b = 0; b < hops; b += 1) {
      ping(t, f * (1 + (rnd() - 0.5) * 0.02), amp, 0.006 + rnd() * 0.02, pan, 2)
      t += gap
      gap *= 0.55
      amp *= 0.5
    }
  }
  let peak = 0
  for (let i = 0; i < n; i += 1) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
  if (peak > 0) {
    const k = 0.9 / peak
    for (let i = 0; i < n; i += 1) {
      L[i] *= k
      R[i] *= k
    }
  }
  return buffer
}

/* ------------------------------------------------------------- Rolling bottle */

/** The one live rolling voice (null when silent). */
let roll = null
const ROLL_WATCHDOG_S = 2.5
/** Scheduler: how often it runs and how far ahead it books events. */
const ROLL_TICK_MS = 25
const ROLL_LOOKAHEAD = 0.075
/** Event levels into the voice (calibrated against the bounce and the music). */
const SEAM_AMP = 1.1
const BEAD_AMP = 0.9
const IMPACT_AMP = 0.18
const BUBBLE_AMP = 0.05
/** Voice output level into the sfx bus. */
const ROLL_OUT = 4.7

/** A click: jump to `amp` at time t and decay with time constant `tau` (automation only). */
function hit(param, t, amp, tau) {
  param.setValueAtTime(amp, t)
  param.setTargetAtTime(0, t + 0.0003, tau)
}

function buildRollVoice({ size = 1, family = 'classic' } = {}) {
  const now = ctx.currentTime
  const s = clamp(Number(size) || 1, 0.6, 1.8)
  const glass = GLASS[family] || GLASS.classic
  const gain = (v) => {
    const g = ctx.createGain()
    g.gain.value = v
    return g
  }
  const filter = (type, freq, q) => {
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    return f
  }

  // Everything the bottle makes -> out (the roll's level and fade) -> panner -> sfx bus.
  // One-shots that should sit where the bottle is (the landings' stone thuds) join at
  // the panner, after the roll's level.
  let panner = null
  if (ctx.createStereoPanner) {
    panner = ctx.createStereoPanner()
    panner.connect(sfxBus)
  }
  const post = panner || sfxBus
  const out = gain(0.0001)
  out.gain.setTargetAtTime(ROLL_OUT, now, 0.03)
  out.connect(post)
  const mix = gain(1)
  mix.connect(out)
  const fxIn = gain(1)
  fxIn.connect(post)

  // The bottle: shell partials, a body mode and the air cavity, all fed from bankIn.
  const bankIn = gain(BANK_GAIN)
  const f0 = (SHELL_HZ * glass.pitch * (0.985 + Math.random() * 0.03)) / Math.pow(s, 0.85)
  const modes = []
  for (const [ratio, tau, level] of SHELL) {
    const f = Math.min(ctx.sampleRate * 0.45, f0 * ratio * (0.99 + Math.random() * 0.02))
    modes.push([f, tau * glass.ring, level])
  }
  modes.push([(480 * glass.pitch) / s, 0.022, 0.35]) // body "clonk"
  modes.push([165 / s, 0.035, 0.7]) // hollow air cavity
  const bank = []
  for (const [f, tau, level] of modes) {
    const bp = filter('bandpass', f, Math.PI * f * tau)
    const g = gain(level)
    bankIn.connect(bp).connect(g).connect(mix)
    bank.push({ bp, f, tau })
  }

  // One looped white noise feeds every click; each kind has its own envelope.
  const noiseSrc = ctx.createBufferSource()
  noiseSrc.buffer = noise
  noiseSrc.loop = true

  // Seam / shoulder knock: rings the glass, plus a soft low thud.
  const seam = gain(0)
  noiseSrc.connect(seam)
  seam.connect(gain(0.55)).connect(bankIn)
  seam.connect(filter('lowpass', 600, 0.7)).connect(gain(0.6)).connect(mix)

  // Gel balls: soft (low-passed) clicks into the glass, and a faint direct tick.
  const bead = gain(0)
  noiseSrc.connect(bead)
  const beadLp = filter('lowpass', 4200, 0.6)
  bead.connect(beadLp)
  beadLp.connect(gain(0.2)).connect(bankIn)
  beadLp.connect(filter('highpass', 1800, 0.7)).connect(gain(0.1)).connect(mix)

  // Landing knock: rings the glass hard, with a bright crack of glass on stone.
  const impact = gain(0)
  noiseSrc.connect(impact)
  impact.connect(gain(1)).connect(bankIn)
  impact.connect(filter('bandpass', 2600, 0.8)).connect(gain(0.25)).connect(mix)

  // The stone grit, pulsing once per turn.
  const crackle = ctx.createBufferSource()
  crackle.buffer = crackleBuffer
  crackle.loop = true
  const bed = gain(0)
  crackle.connect(bed)
  // Grind: the grit high-passed into a bright, crunchy band (glass scraping stone, not a
  // low rumble), and fed into the glass so the bottle rings as it grinds.
  const grindHp = filter('highpass', 900, 0.7)
  const rumble = filter('bandpass', 2200, 1.2)
  bed.connect(grindHp).connect(rumble).connect(filter('lowpass', 5500, 0.6)).connect(gain(3)).connect(mix)
  bed.connect(gain(0.2)).connect(bankIn)
  const lfo = ctx.createOscillator()
  // One bump per turn rather than a smooth sine: an out-of-round bottle.
  const harmonics = 8
  const re = new Float32Array(harmonics + 1)
  const im = new Float32Array(harmonics + 1)
  for (let k = 1; k <= harmonics; k += 1) re[k] = Math.pow(0.85, k)
  lfo.setPeriodicWave(ctx.createPeriodicWave(re, im))
  lfo.frequency.value = 4
  const lfoDepth = gain(0)
  lfo.connect(lfoDepth).connect(bed.gain)

  // The liquid: a sine blipping upwards, like a bubble.
  const bubbleOsc = ctx.createOscillator()
  bubbleOsc.frequency.value = 800
  const bubble = gain(0)
  bubbleOsc.connect(bubble).connect(mix)

  noiseSrc.start(now, Math.random() * 0.5)
  crackle.start(now, Math.random() * CRACKLE_SECONDS)
  lfo.start(now)
  bubbleOsc.start(now)

  return {
    out, mix, fxIn, panner, seam, bead, impact, bed, rumble, lfo, lfoDepth, crackle, noiseSrc, bubbleOsc, bubble, bank,
    sources: [noiseSrc, crackle, lfo, bubbleOsc],
    level: 0.3,
    tumble: 3,
    contact: 1,
    tSeam: now + 0.02,
    neck: false,
    tBead: now + 0.05,
    cluster: 0,
    tBubble: now + 0.2,
    impactAt: -1,
    heard: now,
    last: -1,
    timer: 0,
  }
}

/** Glides the continuous parts toward the current targets (automation only). */
function applyRoll(r, pan) {
  const now = ctx.currentTime
  const v = r.level
  const c = r.contact
  const bed = (0.4 + 0.6 * v) * (0.45 + 0.55 * c)
  r.bed.gain.setTargetAtTime(bed, now, 0.05)
  r.lfoDepth.gain.setTargetAtTime(bed * 0.5, now, 0.05)
  r.lfo.frequency.setTargetAtTime(clamp(r.tumble, 1, 14), now, 0.08)
  r.crackle.playbackRate.setTargetAtTime(0.65 + 0.85 * v, now, 0.08)
  r.rumble.frequency.setTargetAtTime(1500 + 2200 * v + 300 * c, now, 0.08)
  // Lying on the step damps the glass (a dull clunk); in the air it rings out.
  const damp = 1 - 0.55 * c
  for (const m of r.bank) m.bp.Q.setTargetAtTime(Math.PI * m.f * m.tau * damp, now, 0.05)
  if (r.panner && Number.isFinite(pan)) r.panner.pan.setTargetAtTime(clamp(pan, -1, 1), now, 0.08)
}

/** Books the voice's clicks for the next few tens of ms (runs from a timer). */
function scheduleRoll(r) {
  if (roll !== r || !ctx) {
    clearInterval(r.timer)
    return
  }
  const now = ctx.currentTime
  if (now - r.heard > ROLL_WATCHDOG_S) {
    // Updates stopped coming (hidden tab, a stalled frame loop): fade out on our own.
    stopRoll(0.4)
    return
  }
  const end = now + ROLL_LOOKAHEAD
  const v = r.level
  const c = r.contact
  const shake = r.impactAt < 0 ? 0 : Math.max(0, 1 - (now - r.impactAt) / 0.35)

  // Two knocks a turn, lopsided: the heavy shoulder ("tonk") and, a third of a turn
  // later, the lighter neck ("tik") - the limp of a bottle that isn't a true cylinder.
  // Hardest when it's touching the step.
  const seamHz = clamp(r.tumble, 1.2, 11)
  while (r.tSeam < end) {
    if (r.tSeam < now) r.tSeam = now + 0.004
    const period = 1 / seamHz
    const amp = SEAM_AMP * (0.35 + 0.65 * v) * (0.2 + 0.8 * c) * (0.8 + Math.random() * 0.4)
    if (r.neck) {
      hit(r.seam.gain, r.tSeam, amp * 0.5, 0.0015)
      r.tSeam += period * (0.62 + Math.random() * 0.06)
    } else {
      hit(r.seam.gain, r.tSeam, amp, 0.003)
      r.tSeam += period * (0.34 + Math.random() * 0.04)
    }
    r.neck = !r.neck
  }

  // Gel balls: a little cluster of clicks every half turn, a flurry after a landing.
  while (r.tBead < end) {
    if (r.tBead < now) r.tBead = now + 0.003
    const amp = BEAD_AMP * (0.45 + 0.55 * v) * (0.5 + 0.5 * Math.random()) * (1 + 0.8 * shake)
    hit(r.bead.gain, r.tBead, amp, 0.0011)
    if (r.cluster > 0) {
      r.cluster -= 1
      r.tBead += 0.01 + Math.random() * 0.028
    } else {
      r.cluster = (shake > 0.3 ? 2 : 0) + Math.floor(Math.random() * 3)
      r.tBead += (1 / clamp(2 * r.tumble, 2, 14)) * (0.7 + Math.random() * 0.6)
      // Now and then the liquid sloshes: a bubble blip.
      if (r.tBead > r.tBubble && Math.random() < 0.22) {
        const t = r.tBead - 0.004
        const f = 520 + Math.random() * 700
        r.bubbleOsc.frequency.setValueAtTime(f, t)
        r.bubbleOsc.frequency.exponentialRampToValueAtTime(f * (1.5 + Math.random() * 0.4), t + 0.05)
        hit(r.bubble.gain, t, BUBBLE_AMP * (0.5 + 0.5 * v), 0.014)
        r.tBubble = t + 0.12
      }
    }
  }
}

function stopRoll(fade) {
  const r = roll
  if (!r) return
  roll = null
  clearInterval(r.timer)
  duckMusic(false, 0.8)
  if (!ctx) return
  const now = ctx.currentTime
  const f = Math.min(2, Math.max(0.03, Number(fade) || 0.25))
  r.out.gain.cancelScheduledValues(now)
  r.out.gain.setTargetAtTime(0, now, f / 5)
  const end = now + f + 0.05
  r.noiseSrc.onended = () => {
    r.out.disconnect()
    // The panner outlives the roll a moment, for a landing thud still ringing through it.
    setTimeout(() => {
      r.fxIn.disconnect()
      if (r.panner) r.panner.disconnect()
    }, 400)
  }
  for (const src of r.sources) src.stop(end)
}

/** A landing: the glass rings hard and the gel balls inside flurry. */
function rollImpact(r, hard) {
  const now = ctx.currentTime
  hit(r.impact.gain, now + 0.001, IMPACT_AMP * hard, 0.004)
  r.impactAt = now
  r.tBead = Math.min(r.tBead, now + 0.022 + Math.random() * 0.02)
  r.cluster = 3 + Math.floor(Math.random() * 3)
}

export const sfx = {
  /**
   * The bottle starts tumbling down the stairs (see "Glass, synthesised" above). Built once
   * per throw; `rollUpdate` only moves its parameters. `size` scales the pitch (bigger
   * bottles ring lower), `family` picks the glass (materials.js BOTTLE_FAMILY_OF).
   * Silent no-op before the audio unlock or while muted.
   */
  rollStart(opts) {
    try {
      if (stats) stats.rollStart += 1
      if (!ready() || roll) return
      if (!crackleBuffer) crackleBuffer = makeCrackleBuffer(ctx)
      const r = buildRollVoice(opts)
      roll = r
      r.timer = setInterval(() => scheduleRoll(r), ROLL_TICK_MS)
      applyRoll(r, 0)
      scheduleRoll(r)
      duckMusic(true)
      if (stats) stats.rollVoice += 1
    } catch {
      roll = null
    }
  },
  /**
   * Targets for the rolling sound, a few times a second: `intensity` 0 (barely) .. 1
   * (flying down the stairs) sets loudness, grit rate and brightness; `turns` is the
   * tumble rate (revolutions a second: the seam knocks, gel rattle and grit pulse follow
   * it); `contact` 1 = on the step .. 0 = high in the air; `pan` -1..1 is where the bottle
   * is on screen. Extra calls within 30 ms are dropped.
   */
  rollUpdate(intensity = 0.5, turns = 3, contact = 1, pan = 0) {
    try {
      if (stats) stats.rollUpdate += 1
      const r = roll
      if (!r || !ctx) return
      const now = ctx.currentTime
      r.heard = now
      if (now - r.last < 0.03) return
      r.last = now
      r.level = clamp01(intensity)
      r.tumble = clamp(Number(turns) || 3, 0.5, 30)
      r.contact = clamp01(contact)
      applyRoll(r, pan)
    } catch {
      /* never let a sound break the frame */
    }
  },
  /** Fades the rolling sound out over `fade` seconds and frees it. Safe to call any time. */
  rollStop(fade = 0.25) {
    try {
      if (stats && roll) stats.rollStop += 1
      stopRoll(fade)
    } catch {
      roll = null
    }
  },
  /**
   * The bottle lands on a step: a low stone thud and a dry knock, while the bottle's own
   * glass (the rolling voice's resonators) rings and the gel balls inside flurry. `hard`
   * 0..1.4 is how hard it lands (a long hop lands harder), `pan` where it is on screen.
   * Without a rolling voice it falls back to synthesised partials.
   */
  bounce(step = 0, size = 1, hard = 1, pan = 0) {
    if (!ready()) return
    const now = ctx.currentTime
    if (now - lastBounce < 0.04) return
    lastBounce = now
    if (stats) stats.bounce += 1
    const s = clamp(Number(size) || 1, 0.5, 2)
    const h = clamp(Number(hard) || 1, 0.2, 1.4)
    const r = roll
    const bus = r ? r.fxIn : pannedBus(pan)
    tone({ freq: 165 / Math.sqrt(s), to: 58, type: 'sine', dur: 0.11, vol: 0.22 * h, attack: 0.002, bus })
    burst({ dur: 0.045, vol: 0.15 * h, freq: 850, q: 0.9, attack: 0.001, bus })
    if (r) {
      rollImpact(r, h)
      return
    }
    const base = (1250 + ((step * 37) % 420)) / s
    tone({ freq: base, to: base * 0.94, type: 'triangle', dur: 0.14, vol: 0.15 * h, attack: 0.002, bus })
    tone({ freq: base * 2.76, type: 'sine', dur: 0.09, vol: 0.055 * h, attack: 0.002, bus })
    tone({ freq: base * 5.4, type: 'sine', dur: 0.05, vol: 0.025 * h, attack: 0.001, bus })
  },
  /**
   * The big one, in layers: a sharp crack, the low thunk of the bottle on stone, a bright
   * crash that darkens as it spreads, then the shard shower (pre-rendered: a dense break,
   * a thinning spray of tinkles, shards bouncing down the steps), the liquid splashing
   * with a couple of drips and the gel balls patting down. `pan` is where it is on screen.
   */
  shatter(pan = 0, size = 1) {
    if (!ready()) return
    if (stats) stats.shatter += 1
    const s = clamp(Number(size) || 1, 0.5, 2)
    const bus = pannedBus(pan)
    // Crack: a very fast broadband snap.
    burst({ dur: 0.03, vol: 1.4, freq: 3500, q: 0.7, type: 'highpass', attack: 0.0007, bus })
    burst({ dur: 0.07, vol: 0.7, freq: 5000, q: 1.2, sweepTo: 2800, attack: 0.001, bus })
    // Thunk.
    tone({ freq: 140 / Math.sqrt(s), to: 46, type: 'sine', dur: 0.3, vol: 0.95, attack: 0.002, bus })
    burst({ dur: 0.1, vol: 0.5, freq: 300, q: 0.8, type: 'lowpass', attack: 0.002, bus })
    // Crash body, darkening as it spreads.
    burst({ dur: 0.42, vol: 0.62, freq: 6500, q: 0.6, sweepTo: 2200, delay: 0.008, bus })
    if (shardBuffer) {
      // The shower, wide across the stereo field (a touch of random pitch each time).
      const src = ctx.createBufferSource()
      src.buffer = shardBuffer
      src.playbackRate.value = 0.93 + Math.random() * 0.14
      const g = ctx.createGain()
      g.gain.value = 2.6
      src.connect(g).connect(sfxBus)
      src.start(ctx.currentTime + 0.004)
      if (stats) stats.shower += 1
    } else {
      for (let i = 0; i < 12; i += 1) {
        const r = Math.random()
        const f = 2500 + Math.random() * 5500
        tone({ freq: f, to: f * 0.98, type: 'sine', dur: 0.04 + Math.random() * 0.1, vol: 0.14 * (1 - r * 0.6), delay: 0.015 + 0.6 * r * r, attack: 0.001, bus })
      }
    }
    // Splash: the liquid slops out, then a couple of drips (rising "plip"s).
    burst({ dur: 0.42, vol: 0.3, freq: 1300, q: 0.7, sweepTo: 320, delay: 0.03, attack: 0.02, bus })
    for (let i = 0; i < 2; i += 1) {
      const f = 700 + Math.random() * 500
      tone({ freq: f, to: f * 2.1, type: 'sine', dur: 0.06, vol: 0.09, delay: 0.2 + i * 0.17 + Math.random() * 0.08, attack: 0.002, bus })
    }
    // Gel balls patting down: soft, low, quickly falling "tup"s.
    for (let i = 0; i < 4; i += 1) {
      const f = 380 + Math.random() * 260
      tone({ freq: f, to: f * 0.6, type: 'sine', dur: 0.05, vol: 0.12 * (1 - i * 0.14), delay: 0.32 + i * 0.17 + Math.random() * 0.1, attack: 0.002, bus })
    }
  },
  /** A training bounce: each step down the pit rings a little higher. */
  rep(step = 0) {
    if (!ready()) return
    const f = 620 + Math.min(step, 7) * 70
    tone({ freq: f, to: f * 1.25, type: 'triangle', dur: 0.08, vol: 0.12 })
    burst({ dur: 0.04, vol: 0.08, freq: 1100, q: 1 })
  },
  /** An underhand toss into the pit. */
  toss() {
    if (!ready()) return
    burst({ dur: 0.18, vol: 0.12, freq: 600, q: 0.7, sweepTo: 1800 })
  },
  /** The big wind-up and release. */
  throw() {
    if (!ready()) return
    burst({ dur: 0.35, vol: 0.28, freq: 350, q: 0.6, sweepTo: 2400 })
    tone({ freq: 300, to: 620, type: 'sine', dur: 0.25, vol: 0.06 })
  },
  /** A footstep: soft on grass, a little crisper on stone paths. */
  step(hard = false) {
    if (!ready()) return
    const now = ctx.currentTime
    if (now - lastStep < 0.14) return
    lastStep = now
    burst({ dur: 0.06, vol: hard ? 0.09 : 0.06, freq: hard ? 1600 : 500, q: hard ? 1.4 : 0.8, type: 'bandpass' })
    tone({ freq: hard ? 180 : 120, to: 80, type: 'sine', dur: 0.06, vol: 0.05 })
  },
  jump() {
    if (!ready()) return
    tone({ freq: 330, to: 660, type: 'triangle', dur: 0.16, vol: 0.09 })
    burst({ dur: 0.12, vol: 0.07, freq: 900, q: 0.6, sweepTo: 2200 })
  },
  land() {
    if (!ready()) return
    tone({ freq: 140, to: 60, type: 'sine', dur: 0.12, vol: 0.14 })
    burst({ dur: 0.08, vol: 0.09, freq: 420, q: 0.7 })
  },
  buy() {
    if (!ready()) return
    ;[784, 988, 1319, 1568].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.14, vol: 0.15, delay: i * 0.06 }))
    burst({ dur: 0.3, vol: 0.06, freq: 6000, q: 0.4, delay: 0.18 })
  },
  equip() {
    if (!ready()) return
    tone({ freq: 660, to: 990, type: 'triangle', dur: 0.12, vol: 0.13 })
    tone({ freq: 1320, type: 'sine', dur: 0.1, vol: 0.06, delay: 0.06 })
  },
  /** A soft two-note pop: a prompt appeared. */
  prompt() {
    if (!ready()) return
    tone({ freq: 620, to: 700, dur: 0.07, vol: 0.07 })
    tone({ freq: 930, to: 1040, dur: 0.09, vol: 0.06, delay: 0.06 })
  },
  /** Two glasses touching: you walked up to a shop bottle. */
  clink() {
    if (!ready()) return
    tone({ freq: 2637, dur: 0.35, vol: 0.05, attack: 0.002 })
    tone({ freq: 3520, dur: 0.28, vol: 0.035, attack: 0.002, delay: 0.012 })
    tone({ freq: 5274, dur: 0.12, vol: 0.02, attack: 0.002, delay: 0.02 })
  },
  /** A panel slides open. */
  open() {
    if (!ready()) return
    burst({ dur: 0.2, vol: 0.09, freq: 700, q: 1.2, sweepTo: 2600 })
    tone({ freq: 440, to: 660, type: 'triangle', dur: 0.12, vol: 0.05, delay: 0.04 })
  },
  /** A panel closes. */
  close() {
    if (!ready()) return
    burst({ dur: 0.16, vol: 0.07, freq: 2200, q: 1.2, sweepTo: 600 })
    tone({ freq: 520, to: 360, type: 'triangle', dur: 0.09, vol: 0.04, delay: 0.03 })
  },
  /** The eggshell cracks (`stage` 1, 2: louder each time). */
  crack(stage = 1) {
    if (!ready()) return
    const v = 0.12 + stage * 0.06
    burst({ dur: 0.07, vol: v, freq: 3200, q: 0.9, type: 'highpass' })
    burst({ dur: 0.05, vol: v * 0.8, freq: 2400, q: 1, type: 'highpass', delay: 0.05 })
    tone({ freq: 190, to: 90, type: 'square', dur: 0.05, vol: 0.05 })
  },
  /**
   * The pet pops out: a sparkle arpeggio over a shimmer, longer and higher for rarer pets
   * (`rank` 0 = common .. 4 = legendary).
   */
  reveal(rank = 0) {
    if (!ready()) return
    burst({ dur: 0.5 + rank * 0.15, vol: 0.12, freq: 1800, q: 0.6, sweepTo: 7000 })
    const notes = [523, 659, 784, 1047, 1319, 1568, 2093].slice(0, 4 + Math.min(3, rank))
    notes.forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.2, vol: 0.09, delay: 0.05 + i * 0.07 }))
    if (rank >= 3) tone({ freq: 262, to: 524, type: 'sawtooth', dur: 0.6, vol: 0.05 })
  },
  /** A bottle unlocked: a bright ding with a shimmer and a low thump. */
  unlock() {
    if (!ready()) return
    tone({ freq: 110, to: 70, type: 'sine', dur: 0.25, vol: 0.18 })
    tone({ freq: 1047, type: 'triangle', dur: 0.4, vol: 0.1, delay: 0.02 })
    tone({ freq: 1568, type: 'triangle', dur: 0.45, vol: 0.08, delay: 0.1 })
    tone({ freq: 2093, type: 'sine', dur: 0.5, vol: 0.06, delay: 0.18 })
    burst({ dur: 0.7, vol: 0.08, freq: 3000, q: 0.5, sweepTo: 9000, delay: 0.05 })
  },
  /** Something inside an egg knocks (its wobble). */
  rattle() {
    if (!ready()) return
    for (let i = 0; i < 3; i += 1) burst({ dur: 0.04, vol: 0.05, freq: 1800 + i * 300, q: 2, delay: i * 0.07 })
  },
  /** A bird somewhere over the lobby wall (ambience, very quiet). */
  chirp() {
    if (!ready()) return
    const base = 2300 + Math.random() * 900
    const n = 2 + Math.floor(Math.random() * 3)
    for (let i = 0; i < n; i += 1) tone({ freq: base, to: base * 1.35, dur: 0.06, vol: 0.022, delay: i * 0.11 })
  },
  hatch() {
    if (!ready()) return
    burst({ dur: 0.18, vol: 0.3, freq: 1500, q: 1 })
    ;[523, 659, 784, 1047, 1319].forEach((f, i) => tone({ freq: f, type: 'square', dur: 0.14, vol: 0.06, delay: 0.1 + i * 0.07 }))
  },
  rebirth() {
    if (!ready()) return
    tone({ freq: 220, to: 880, type: 'sawtooth', dur: 0.7, vol: 0.1 })
    burst({ dur: 0.8, vol: 0.16, freq: 400, q: 0.5, sweepTo: 5000 })
    ;[880, 1108, 1318, 1760, 2217].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.24, vol: 0.11, delay: 0.5 + i * 0.08 }))
  },
  levelUp() {
    if (!ready()) return
    ;[660, 880, 1100, 1320].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.11, vol: 0.13, delay: i * 0.055 }))
  },
  /** A Win coin collected on the stairs. */
  pickup() {
    if (!ready()) return
    tone({ freq: 1568, type: 'sine', dur: 0.09, vol: 0.12 })
    tone({ freq: 2093, type: 'sine', dur: 0.14, vol: 0.1, delay: 0.06 })
  },
  /** Through a stage gate. */
  zone() {
    if (!ready()) return
    ;[784, 988, 1175, 1568].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.18, vol: 0.12, delay: i * 0.07 }))
  },
  click() {
    if (!ready()) return
    tone({ freq: 880, to: 620, type: 'sine', dur: 0.06, vol: 0.11 })
    burst({ dur: 0.03, vol: 0.05, freq: 3000, q: 1.5 })
  },
  hover() {
    if (!ready()) return
    const now = ctx.currentTime
    if (now - lastHover < 0.06) return
    lastHover = now
    tone({ freq: 1400, type: 'sine', dur: 0.035, vol: 0.035 })
  },
  error() {
    if (!ready()) return
    tone({ freq: 240, to: 170, type: 'square', dur: 0.16, vol: 0.07 })
    tone({ freq: 180, to: 130, type: 'square', dur: 0.16, vol: 0.06, delay: 0.1 })
  },
}

/* --------------------------------------------------------------------- Music */

/**
 * A light, looping tune made on the fly: a four-chord progression with a bouncy bass, a
 * pentatonic melody and soft hats, scheduled a little ahead with a 50 ms timer (never
 * from the render loop). It dips under a throw (`duckMusic`).
 */
const BPM = 108
const STEP = 60 / BPM / 2 // eighth notes
const CHORDS = [
  [261.63, 329.63, 392.0], // C
  [220.0, 261.63, 329.63], // Am
  [174.61, 220.0, 261.63], // F
  [196.0, 246.94, 293.66], // G
]
const MELODY = [
  0, -1, 4, -1, 3, 2, 0, -1, 2, -1, 4, 5, 4, -1, 2, -1,
  0, -1, 2, 3, 4, -1, 7, -1, 5, 4, 2, -1, 0, -1, -1, -1,
]
const PENTA = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51]

let musicTimer = null
let nextTime = 0
let stepIndex = 0

function scheduleStep(i, t) {
  const bar = Math.floor(i / 8) % CHORDS.length
  const chord = CHORDS[bar]
  const inBar = i % 8
  const at = t - ctx.currentTime
  // Bass on the beat, a fifth on the off-beat.
  if (inBar % 2 === 0) tone({ freq: chord[0] / 2, type: 'triangle', dur: STEP * 1.6, vol: 0.12, delay: at, attack: 0.01, bus: musicBus })
  else if (inBar === 3 || inBar === 7) tone({ freq: chord[2] / 2, type: 'triangle', dur: STEP, vol: 0.07, delay: at, bus: musicBus })
  // Soft chord pad at the start of each bar.
  if (inBar === 0) chord.forEach((f) => tone({ freq: f, type: 'sine', dur: STEP * 7, vol: 0.025, delay: at, attack: 0.15, bus: musicBus }))
  // Melody.
  const note = MELODY[i % MELODY.length]
  if (note >= 0) tone({ freq: PENTA[note], type: 'square', dur: STEP * 0.9, vol: 0.022, delay: at, attack: 0.01, bus: musicBus })
  // Hats on the off-beats.
  if (inBar % 2 === 1) burst({ dur: 0.04, vol: 0.04, freq: 8000, q: 0.7, type: 'highpass', delay: at, bus: musicBus })
}

function startMusic() {
  if (!ctx || musicTimer) return
  musicBus.gain.setTargetAtTime(musicLevel(), ctx.currentTime, 1.2)
  nextTime = ctx.currentTime + 0.1
  musicTimer = setInterval(() => {
    if (!ctx || ctx.state !== 'running') return
    while (nextTime < ctx.currentTime + 0.3) {
      scheduleStep(stepIndex, nextTime)
      stepIndex += 1
      nextTime += STEP
    }
  }, 50)
}

function stopMusic() {
  if (!ctx) return
  musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.3)
  setTimeout(() => {
    if (!musicWanted && musicTimer) {
      clearInterval(musicTimer)
      musicTimer = null
    }
  }, 1200)
}

/** Background music on/off (it waits for the first tap either way). */
export function setMusic(on) {
  musicWanted = on
  if (!ctx || ctx.state !== 'running') return
  if (on) {
    if (!musicTimer) startMusic()
    else musicBus.gain.setTargetAtTime(musicLevel(), ctx.currentTime, 0.4)
  } else stopMusic()
}
