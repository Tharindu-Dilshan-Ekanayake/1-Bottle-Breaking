import { Color } from 'three'

import { ZONES } from '@shared/balance'

import { runtime } from './runtime'

/**
 * How each stage theme looks. The stage list itself (names, Power walls, Wins) is game
 * data in @shared/balance; this is only colour.
 */
export const THEME_LOOKS = {
  garden: {
    terrace: ['#5ed64b', '#52c642'], lane: ['#d7f7c4', '#c4efae'], rail: '#3f9e35',
    prop: 'tree', propA: '#3cc23a', propB: '#7a4f2c', sky: ['#2a8af5', '#9ad3ff'], accent: '#4ade80',
  },
  shore: {
    terrace: ['#f4d98e', '#ecca72'], lane: ['#fff4d4', '#fbe9b8'], rail: '#d9a74e',
    prop: 'palm', propA: '#22b866', propB: '#a8743f', sky: ['#1f9bf0', '#b7ecff'], accent: '#facc15',
  },
  snow: {
    terrace: ['#eef6ff', '#dceaf9'], lane: ['#bfe3ff', '#a9d6fb'], rail: '#7fb2dd',
    prop: 'pine', propA: '#2f8f5b', propB: '#6b4a2e', sky: ['#5b8fd6', '#dceeff'], accent: '#7dd3fc',
  },
  crystal: {
    terrace: ['#6d5bd0', '#5e4dbf'], lane: ['#c4b5fd', '#b3a1fb'], rail: '#3f2f99',
    prop: 'crystal', propA: '#5eead4', propB: '#e879f9', sky: ['#3b2a8f', '#9c8cf0'], accent: '#a78bfa',
  },
  neon: {
    terrace: ['#2a2342', '#231d38'], lane: ['#ff5fb7', '#f2479f'], rail: '#22d3ee',
    prop: 'tower', propA: '#f472b6', propB: '#22d3ee', sky: ['#120b2e', '#5b2a86'], accent: '#f472b6',
  },
  cloud: {
    terrace: ['#ffffff', '#eef2ff'], lane: ['#fde68a', '#fcd34d'], rail: '#c7d2fe',
    prop: 'cloud', propA: '#ffffff', propB: '#e0e7ff', sky: ['#60a5fa', '#fdf4ff'], accent: '#fde68a',
  },
  cosmos: {
    terrace: ['#1b1440', '#150f33'], lane: ['#4c1d95', '#3b1478'], rail: '#a78bfa',
    prop: 'star', propA: '#c084fc', propB: '#fef08a', sky: ['#05030f', '#2e1065'], accent: '#c084fc',
  },
}

/** World 2 (Candy Peaks) wears every theme in sweeter colours: each mixed this much towards pink. */
const CANDY = new Color('#ff8fd0')
const CANDY_MIX = 0.32
const mix = (hex) => `#${new Color(hex).lerp(CANDY, CANDY_MIX).getHexString()}`
const sweeten = (value) => (Array.isArray(value) ? value.map(sweeten) : typeof value === 'string' && value.startsWith('#') ? mix(value) : value)
const CANDY_LOOKS = Object.fromEntries(
  Object.entries(THEME_LOOKS).map(([id, look]) => [id, Object.fromEntries(Object.entries(look).map(([k, v]) => [k, sweeten(v)]))]),
)

/** The look of stage `index`, in the world you're in. */
export const zoneLook = (index) => {
  const theme = ZONES[Math.max(0, Math.min(ZONES.length - 1, index))].theme
  return (runtime.world === 2 ? CANDY_LOOKS : THEME_LOOKS)[theme]
}
