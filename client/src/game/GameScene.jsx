import { PerformanceMonitor } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'

import { useBloxity } from '../bloxity/BloxityContext'
import { useBloxityStore } from '../bloxity/store'
import { useGame } from '../store/game'
import CameraRig from './CameraRig'
import Lighting from './Lighting'
import { PlayerAura } from './Auras'
import Lobby from './Lobby'
import { setBlockAnisotropy } from './materials'
import PerfProbe from './PerfProbe'
import Pets from './Pets'
import Player from './Player'
import PopupProjector from './PopupProjector'
import PromptProjector from './PromptProjector'
import TutorialArrows from './TutorialArrows'
import Sky from './Sky'
import { PRESETS, useQuality } from './stores/quality'
import { useUi } from './stores/ui'
import PitBottle from './PitBottle'
import RemoteAvatars from './remote/RemoteAvatars'
import RemotePlayers from './remote/RemotePlayers'

/** How long the loading screen waits for the remote avatar after the lobby is drawn. */
const AVATAR_GRACE_MS = 900
/** How long after the loading screen lifts the decorative extras mount. */
const SETTLE_MS = 700

/**
 * Reports, outside the frame loop, once the scene has committed and painted twice.
 * Mounted next to the lobby (which never suspends), so this means "lobby visible".
 */
function SceneReady({ onReady }) {
  useEffect(() => {
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => onReady())
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [onReady])
  return null
}

/** The longest the first frame waits on shader warm-up before drawing anyway. */
const WARMUP_LIMIT_MS = 2500

/**
 * Compiles every shader in the lobby in parallel (KHR_parallel_shader_compile) before
 * the first frame, instead of one blocking compile after another inside it. The
 * Canvas runs with frameloop "never" until this reports done.
 */
function ShaderWarmup({ onDone }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    let finished = false
    const done = (how) => {
      if (finished) return
      finished = true
      clearTimeout(limit)
      performance.mark(`bt:warm-${how}`)
      onDone()
    }
    performance.mark('bt:warm-start')
    const limit = setTimeout(() => done('limit'), WARMUP_LIMIT_MS)
    gl.compileAsync(scene, camera).then(
      () => done('compiled'),
      () => done('failed'),
    )
    return () => {
      finished = true
      clearTimeout(limit)
    }
  }, [gl, scene, camera, onDone])
  return null
}

/** The staircase + throw logic is its own chunk, fetched after the lobby is up. */
const Staircase = lazy(() => import('./stage/Staircase'))

/** r3f-perf is dev-only: this branch (and its import) is removed from production builds. */
const DevPerf = import.meta.env.DEV
  ? lazy(() => import('r3f-perf').then((m) => ({ default: m.Perf })))
  : null

/** Keeps a broken dev overlay from taking the game down with it. */
class Quiet extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

function DevPerfOverlay() {
  // Off by default: open the game with ?r3fperf (or press F2) to see it.
  const [show, setShow] = useState(() => new URLSearchParams(window.location.search).has('r3fperf'))
  useEffect(() => {
    const onKey = (e) => {
      if (e.code === 'F2') setShow((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  if (!DevPerf || !show) return null
  return (
    <Quiet>
      <Suspense fallback={null}>
        <DevPerf position="bottom-right" minimal={false} />
      </Suspense>
    </Quiet>
  )
}

export function GameScene() {
  const { game } = useBloxity()
  const preset = useQuality((s) => s.preset)
  const dropPreset = useQuality((s) => s.dropPreset)
  const q = PRESETS[preset]
  const loaded = useUi((s) => s.loaded)
  const adBreak = useBloxityStore((s) => s.adBreak)
  /** Shaders compiled: the frame loop may start. Stays true across canvas rebuilds. */
  const [warm, setWarm] = useState(false)
  const handleWarm = useCallback(() => setWarm(true), [])
  const settled = useUi((s) => s.settled)
  const world = useGame((s) => s.profile.world || 1)
  const [canvasKey, setCanvasKey] = useState(0)
  const loadingEnded = useRef(false)
  const lostTimer = useRef(null)

  useEffect(() => {
    game.loadingStep('Building the lobby…')
  }, [game])

  useEffect(() => {
    setBlockAnisotropy(q.anisotropy)
  }, [q.anisotropy])

  useEffect(() => () => clearTimeout(lostTimer.current), [])

  /**
   * The loading screen lifts once the lobby has been drawn. The Bloxity avatar comes
   * from a third-party CDN, so it gets a short grace period; if it's slower than that
   * the block avatar stands in and is swapped out the moment the real one arrives.
   */
  const avatarReady = useRef(false)
  const graceTimer = useRef(null)
  const settleTimer = useRef(null)
  const finishLoading = useCallback(() => {
    if (loadingEnded.current) return
    loadingEnded.current = true
    clearTimeout(graceTimer.current)
    useUi.setState({ loaded: true })
    game.loadingEnd()
    // Decorative extras (auras, barriers, the bottle on your back) compile their shaders
    // after the loading screen has faded, not while the player waits on it.
    settleTimer.current = setTimeout(() => useUi.setState({ settled: true }), SETTLE_MS)
  }, [game])

  const handleAvatarReady = useCallback(() => {
    performance.mark('bt:avatar-ready')
    avatarReady.current = true
    // Already showing the lobby? Then the swap just happens in place.
    if (graceTimer.current) finishLoading()
  }, [finishLoading])

  const handleSceneReady = useCallback(() => {
    performance.mark('bt:scene-ready')
    if (avatarReady.current) finishLoading()
    else graceTimer.current = setTimeout(finishLoading, AVATAR_GRACE_MS)
  }, [finishLoading])

  useEffect(
    () => () => {
      clearTimeout(graceTimer.current)
      clearTimeout(settleTimer.current)
    },
    [],
  )

  // Remounting the Canvas builds a fresh renderer + context and re-creates every GPU
  // resource. Used for context-loss recovery.
  const remount = useCallback(() => {
    clearTimeout(lostTimer.current)
    useUi.setState({ contextLost: false })
    setCanvasKey((k) => k + 1)
  }, [])

  /** The live canvas. Events from a replaced canvas (R3F force-loses the old context
   *  when it disposes a renderer) must not trigger another recovery cycle. */
  const liveCanvas = useRef(null)

  const handleCreated = useCallback(
    ({ gl }) => {
      performance.mark('bt:canvas-created')
      // Checking every shader for errors forces a synchronous wait on each compile;
      // dev builds keep it, production skips it (it is a big part of time to playable).
      if (import.meta.env.PROD) gl.debug.checkShaderErrors = false
      const canvas = gl.domElement
      liveCanvas.current = canvas
      canvas.addEventListener('webglcontextlost', (e) => {
        if (canvas !== liveCanvas.current) return
        // preventDefault tells the browser we intend to recover.
        e.preventDefault()
        useUi.setState({ contextLost: true })
        // If the browser never restores it, rebuild from scratch.
        clearTimeout(lostTimer.current)
        lostTimer.current = setTimeout(remount, 4000)
      })
      canvas.addEventListener('webglcontextrestored', () => {
        if (canvas === liveCanvas.current) remount()
      })
    },
    [remount],
  )

  // drei calls onDecline from inside its frame loop; defer the store write out of it.
  const handleDecline = useCallback(() => {
    setTimeout(dropPreset, 0)
  }, [dropPreset])

  return (
    <Canvas
      // A preset change rebuilds the renderer (shadow maps, dpr, AA all change).
      key={`${preset}-${canvasKey}`}
      dpr={q.dpr}
      shadows={q.shadows ? 'percentage' : false}
      flat
      gl={{ antialias: q.antialias, powerPreference: 'high-performance', stencil: false }}
      camera={{ position: [0, 6, 20], fov: 60, near: 0.1, far: q.viewDistance }}
      onCreated={handleCreated}
      // Paused while shaders warm up, and during a Boxity ad break.
      frameloop={warm && !adBreak ? 'always' : 'never'}
    >
      {!warm && <ShaderWarmup onDone={handleWarm} />}
      <PerformanceMonitor bounds={() => [45, 1000]} onDecline={handleDecline} />
      <Sky />
      <Lighting />
      <Lobby />
      {warm && <SceneReady onReady={handleSceneReady} />}
      <Player onAvatarReady={handleAvatarReady} />
      {/* Not needed for the first frame: they mount once the lobby is on screen (while
          the loading screen fades), so their setup and shaders stay off the critical
          path. */}
      {loaded && <RemotePlayers />}
      {loaded && <RemoteAvatars />}
      {loaded && <Pets />}
      {loaded && <PitBottle />}
      {settled && <PlayerAura />}
      {loaded && (
        <Suspense fallback={null}>
          {/* Rebuilt per world: its stairs are coloured for the world you throw in. */}
          <Staircase key={world} />
        </Suspense>
      )}
      <CameraRig />
      {loaded && <PopupProjector />}
      {loaded && <PromptProjector />}
      {loaded && <TutorialArrows />}
      <PerfProbe />
      {import.meta.env.DEV && <DevPerfOverlay />}
    </Canvas>
  )
}

export default GameScene
