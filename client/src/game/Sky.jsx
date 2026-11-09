import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BackSide,
  BufferAttribute,
  Color,
  Fog,
  IcosahedronGeometry,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  ShaderMaterial,
  SphereGeometry,
  Triangle,
  Vector3,
} from 'three'

import { ZONES } from '@shared/balance'
import { zoneIndexAt } from '@shared/logic'
import { stairIndexAtZ, STAIR } from '@shared/world'

import { useGame } from '../store/game'
import { runtime } from './runtime'
import { CLOUDS, LIGHTS } from './sceneStyle'
import { PRESETS, useQuality } from './stores/quality'
import { THEME_LOOKS } from './themes'

const CLOUD_DRIFT = 0.004

/**
 * Each world's sky over the lobby and the first stage: zenith, a lighter band low in
 * the sky, the horizon (also the fog colour, so distant ground melts into it) and a
 * soft glow round the sun. Sun directions match Lighting.jsx.
 *
 * World 1: a clear, deep-blue day. World 2 (Candy Peaks): candy dusk, a violet zenith
 * over a pink band, a warm low sun and purple haze.
 */
const WORLD_SKIES = {
  1: {
    top: '#2a7cee', mid: '#6ab6fb', horizon: '#a8dafc',
    glow: '#fff3d1', glowStrength: 0.55, clouds: '#ffffff', sunDirection: LIGHTS.sunDirection,
  },
  2: {
    top: '#5b3aa8', mid: '#ff9cc8', horizon: '#c79ae6',
    glow: '#ffb27a', glowStrength: 1.1, clouds: '#ffd3ea', sunDirection: [-0.62, 0.5, 0.42],
  },
}
/** Deeper stages keep their own theme sky; in world 2 sweetened towards pink (as themes.js does). */
const CANDY = new Color('#ff8fd0')
const CANDY_MIX = 0.32

function buildSkyTargets(world) {
  const sky = WORLD_SKIES[world]
  const top = []
  const mid = []
  const horizon = []
  ZONES.forEach((zone, i) => {
    if (i === 0) {
      top.push(new Color(sky.top))
      mid.push(new Color(sky.mid))
      horizon.push(new Color(sky.horizon))
      return
    }
    const [t, h] = (THEME_LOOKS[zone.theme] || THEME_LOOKS.garden).sky
    const ct = new Color(t)
    const ch = new Color(h)
    if (world === 2) {
      ct.lerp(CANDY, CANDY_MIX)
      ch.lerp(CANDY, CANDY_MIX)
    }
    top.push(ct)
    mid.push(ct.clone().lerp(ch, 0.6))
    horizon.push(ch)
  })
  return {
    top,
    mid,
    horizon,
    glow: new Color(sky.glow),
    glowStrength: sky.glowStrength,
    clouds: new Color(sky.clouds),
    sunDirection: new Vector3(...sky.sunDirection).normalize(),
  }
}

// Converted once; the frame loop only lerps towards these.
const SKY_TARGETS = { 1: buildSkyTargets(1), 2: buildSkyTargets(2) }

const skyVertexShader = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const skyFragmentShader = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 midColor;
  uniform vec3 horizonColor;
  uniform vec3 glowColor;
  uniform vec3 sunDirection;
  uniform float glowStrength;
  varying vec3 vDirection;
  void main() {
    vec3 dir = normalize(vDirection);
    float h = dir.y;
    // Haze at the horizon, a light band just above it, deepening towards the zenith.
    vec3 color = mix(horizonColor, midColor, smoothstep(-0.03, 0.14, h));
    color = mix(color, topColor, pow(clamp((h - 0.06) / 0.94, 0.0, 1.0), 0.7));
    // Soft glow round the sun, wide and faint plus a tighter bright core.
    float s = max(dot(dir, sunDirection), 0.0);
    color += glowColor * glowStrength * (pow(s, 5.0) * 0.25 + pow(s, 40.0) * 0.5);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`

/**
 * Gradient sky + fog in the palette of the world you're in, blending towards the
 * colours of whichever zone the camera is looking at, so tumbling into the Cosmos turns
 * the sky dark. Changing worlds blends too.
 *
 * Colours are lerped in place on preallocated objects: no allocation per frame.
 */
function SkyDome({ radius, world }) {
  const ref = useRef(null)
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  const preset = useQuality((s) => s.preset)
  const { fogNear, fogFar } = PRESETS[preset]

  const geometry = useMemo(() => new SphereGeometry(1, 24, 12), [])
  const material = useMemo(() => {
    const start = SKY_TARGETS[1]
    return new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: start.top[0].clone() },
        midColor: { value: start.mid[0].clone() },
        horizonColor: { value: start.horizon[0].clone() },
        glowColor: { value: start.glow.clone() },
        sunDirection: { value: start.sunDirection.clone() },
        glowStrength: { value: start.glowStrength },
      },
      vertexShader: skyVertexShader,
      fragmentShader: skyFragmentShader,
    })
  }, [])
  const snapped = useRef(false)

  // Fog is owned here so its colour can follow the sky's horizon.
  useEffect(() => {
    scene.fog = new Fog(material.uniforms.horizonColor.value.getHex(), fogNear, fogFar)
    return () => {
      scene.fog = null
    }
  }, [scene, fogNear, fogFar, material])

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  useFrame((_s, delta) => {
    const mesh = ref.current
    if (mesh) mesh.position.copy(camera.position)

    const target = SKY_TARGETS[world]
    const zi = runtime.focus.z < STAIR.startZ ? zoneIndexAt(stairIndexAtZ(runtime.focus.z)) : 0
    // The first frame snaps (no fade in from world 1); after that colours drift.
    const k = snapped.current ? 1 - Math.pow(0.02, delta) : 1
    snapped.current = true
    const u = material.uniforms
    u.topColor.value.lerp(target.top[zi], k)
    u.midColor.value.lerp(target.mid[zi], k)
    u.horizonColor.value.lerp(target.horizon[zi], k)
    u.glowColor.value.lerp(target.glow, k)
    u.sunDirection.value.lerp(target.sunDirection, k).normalize()
    u.glowStrength.value += ((zi === 0 ? target.glowStrength : target.glowStrength * 0.5) - u.glowStrength.value) * k
    if (scene.fog) scene.fog.color.copy(u.horizonColor.value)
  })

  return (
    <mesh
      ref={ref}
      geometry={geometry}
      material={material}
      scale={radius}
      renderOrder={-1}
      frustumCulled={false}
    />
  )
}

function mulberry32(seed) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Faceted puff with sun-facing shading baked into vertex colours. */
function createPuffGeometry() {
  const geometry = new IcosahedronGeometry(1, 1)
  const position = geometry.getAttribute('position')
  const colors = new Float32Array(position.count * 3)
  const top = new Color(CLOUDS.top)
  const bottom = new Color(CLOUDS.bottom)
  const sun = new Vector3(...LIGHTS.sunDirection).normalize()
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  const n = new Vector3()
  const col = new Color()
  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i)
    b.fromBufferAttribute(position, i + 1)
    c.fromBufferAttribute(position, i + 2)
    Triangle.getNormal(a, b, c, n)
    if (n.dot(a) < 0) n.negate()
    const up = n.y * 0.5 + 0.5
    const lit = Math.max(n.dot(sun), 0) * 0.35
    col.copy(bottom).lerp(top, Math.min(1, up * 0.85 + lit))
    for (let v = 0; v < 3; v += 1) col.toArray(colors, (i + v) * 3)
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  return geometry
}

/**
 * All clouds are ONE InstancedMesh (one draw call), not a mesh per puff.
 * Count comes from the quality preset; LOW renders none.
 */
function Clouds({ count, spread, world }) {
  const ref = useRef(null)
  const camera = useThree((s) => s.camera)

  const mesh = useMemo(() => {
    const rand = mulberry32(7)
    const puffs = []
    for (let i = 0; i < count; i += 1) {
      const size = 7 + rand() * 6
      // Relative to the camera (the group follows it), inside the far plane.
      const cx = (rand() * 2 - 1) * spread
      const cy = 30 + rand() * 16
      const cz = (rand() * 2 - 1) * spread
      const n = 3 + Math.floor(rand() * 3)
      for (let p = 0; p < n; p += 1) {
        const along = (p - (n - 1) / 2) * size * 0.9
        const s = size * (0.75 + rand() * 0.35) * (1 - Math.abs(along) / (size * n * 0.6))
        puffs.push([cx + along, cy + (rand() - 0.3) * size * 0.4, cz + (rand() - 0.5) * size * 0.6, s, s * 0.75, s * 0.85])
      }
      puffs.push([cx + (rand() - 0.5) * size, cy + size * 0.55, cz, size * 0.8, size * 0.65, size * 0.7])
    }
    const geometry = createPuffGeometry()
    const material = new MeshBasicMaterial({ vertexColors: true, fog: false })
    const inst = new InstancedMesh(geometry, material, Math.max(1, puffs.length))
    const dummy = new Object3D()
    puffs.forEach(([x, y, z, sx, sy, sz], i) => {
      dummy.position.set(x, y, z)
      dummy.scale.set(sx, sy, sz)
      dummy.updateMatrix()
      inst.setMatrixAt(i, dummy.matrix)
    })
    inst.count = puffs.length
    inst.instanceMatrix.needsUpdate = true
    inst.computeBoundingSphere()
    inst.frustumCulled = false
    return inst
  }, [count, spread])

  useEffect(
    () => () => {
      mesh.geometry.dispose()
      mesh.material.dispose()
      mesh.dispose()
    },
    [mesh],
  )

  useFrame((_s, delta) => {
    const g = ref.current
    if (!g) return
    // Follows the camera like the dome, so clouds stay overhead all the way down.
    g.position.copy(camera.position)
    g.rotation.y += delta * CLOUD_DRIFT
    // Tinted to the world's light: white by day, candy pink at dusk.
    mesh.material.color.lerp(SKY_TARGETS[world].clouds, 1 - Math.pow(0.05, delta))
  })

  return (
    <group ref={ref}>
      <primitive object={mesh} />
    </group>
  )
}

export function Sky() {
  const preset = useQuality((s) => s.preset)
  const world = useGame((s) => (s.profile.world === 2 ? 2 : 1))
  const { clouds, viewDistance } = PRESETS[preset]
  // Must sit inside the camera's far plane.
  const radius = Math.min(450, viewDistance * 0.92)
  return (
    <>
      <SkyDome radius={radius} world={world} />
      {clouds > 0 && <Clouds count={clouds} spread={Math.min(200, viewDistance * 0.55)} world={world} />}
    </>
  )
}

export default Sky
