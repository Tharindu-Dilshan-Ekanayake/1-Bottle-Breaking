import { Canvas, useFrame } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'

import { useBloxity } from '../bloxity/BloxityContext'
import FollowCamera from './FollowCamera'
import Ground from './Ground'
import Lighting from './Lighting'
import Player from './Player'
import { FOG, SKY } from './sceneStyle'
import Sky from './Sky'

/**
 * Fires `onFirstFrame` after the renderer has actually drawn once.
 * `loadingEnd()` should mean "the player can see the game", not "React mounted".
 */
function FirstFrameSignal({ onFirstFrame }) {
  const fired = useRef(false)
  useFrame(() => {
    if (fired.current) return
    fired.current = true
    onFirstFrame()
  })
  return null
}

export function GameScene() {
  const { game } = useBloxity()
  const playerBodyRef = useRef(null)

  const [avatarReady, setAvatarReady] = useState(false)
  const loadingEnded = useRef(false)

  const handleAvatarReady = useCallback(() => setAvatarReady(true), [])

  // Only end the loading screen once the avatar has finished assembling *and* a
  // frame has rendered with it in place.
  const handleFirstFrame = useCallback(() => {
    if (loadingEnded.current || !avatarReady) return
    loadingEnded.current = true
    game.loadingEnd()
  }, [avatarReady, game])

  // The first frame usually renders before the avatar finishes downloading, so the
  // frame callback alone isn't enough — close the loading screen here too.
  useEffect(() => {
    if (!avatarReady || loadingEnded.current) return
    loadingEnded.current = true
    game.loadingEnd()
  }, [avatarReady, game])

  useEffect(() => {
    game.loadingStep('Preparing scene…')
  }, [game])

  return (
    <Canvas
      // PCF, not R3F's default "soft": three r18x removed PCFSoftShadowMap and falls
      // back to PCF with a console warning. PCF honours shadow.radius for soft edges.
      shadows="percentage"
      // No tone mapping. The default (ACES) compresses and desaturates highlights,
      // which turns the lime grass and blue sky muddy. Colours and light levels in
      // sceneStyle.js are chosen to look right without it.
      flat
      camera={{ position: [0, 5, 10], fov: 60, far: 1000 }}
      onCreated={({ gl }) => gl.setClearColor(SKY.horizon)}
    >
      <fog attach="fog" args={[FOG.color, FOG.near, FOG.far]} />
      <Sky />
      <Lighting followRef={playerBodyRef} />

      <Suspense fallback={null}>
        <Physics gravity={[0, -18, 0]}>
          <Ground />
          <Player
            bodyRef={playerBodyRef}
            position={[0, 3, 8]}
            onAvatarReady={handleAvatarReady}
          />
        </Physics>
      </Suspense>

      <FollowCamera bodyRef={playerBodyRef} />
      <FirstFrameSignal onFirstFrame={handleFirstFrame} />
    </Canvas>
  )
}

export default GameScene
