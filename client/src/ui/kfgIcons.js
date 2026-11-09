/**
 * Icon set from the +1 Kick Field Goal game (same author), reused here.
 *
 * The game's icon set, hand-drawn as SVG: glossy cartoon style with thick dark outlines,
 * matching the reference HUD. Strings rather than components so the same art feeds
 * both the DOM HUD (<img src>) and the canvas-drawn 3D world labels.
 *
 * Every icon uses a 100x100 viewBox. Gradient ids are prefixed per icon so icons can
 * be inlined side by side without clashing.
 */

import rebirthImage from '../assets/rebirth.webp'

const OUT = '#1b1b1f'

/** Icons that are artwork rather than drawn SVG, by name. */
const IMAGE_ICONS = {
  // The game's own rebirth art: pink and ice-blue chasing arrows (150 px, 5 KB).
  rebirth: rebirthImage,
}

const svg = (body, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs>${defs}</defs>${body}</svg>`

const vgrad = (id, stops) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops
    .map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`)
    .join('')}</linearGradient>`

const GOLD = [
  [0, '#fff6a3'],
  [0.45, '#ffcf2e'],
  [1, '#f08c00'],
]

const trophy = svg(
  `<g stroke="${OUT}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round">
    <path d="M27 24H11c0 19 9 28 22 30" fill="none" stroke-width="13"/>
    <path d="M73 24h16c0 19-9 28-22 30" fill="none" stroke-width="13"/>
  </g>
  <g fill="none" stroke="url(#tr-g)" stroke-width="5" stroke-linecap="round">
    <path d="M27 24H11c0 19 9 28 22 30"/><path d="M73 24h16c0 19-9 28-22 30"/>
  </g>
  <g stroke="${OUT}" stroke-width="5" stroke-linejoin="round" fill="url(#tr-g)">
    <path d="M42 62h16l3 15H39z"/>
    <rect x="27" y="76" width="46" height="15" rx="5"/>
    <path d="M22 12h56v22c0 19-12 30-28 30S22 53 22 34z"/>
  </g>
  <path d="M50 21l4.6 9.4 10.4 1.5-7.5 7.3 1.8 10.3L50 44.6l-9.3 4.9 1.8-10.3-7.5-7.3 10.4-1.5z" fill="#fffbd1" stroke="#d98900" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M30 18v16c0 8 3 14 8 18" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" opacity=".75"/>`,
  vgrad('tr-g', GOLD),
)

const muscle = svg(
  `<path d="M14 88V64c0-20 22-30 38-14l4 3V34c-3-6-3-14 3-19 7-6 19-6 25 2 5 7 5 16-1 21l1 34c0 10-8 17-18 17z" fill="url(#mu-g)" stroke="${OUT}" stroke-width="6" stroke-linejoin="round"/>
  <path d="M56 53c4 3 9 3 13-1" fill="none" stroke="${OUT}" stroke-width="5" stroke-linecap="round"/>
  <path d="M62 24c3-3 8-4 12-2" fill="none" stroke="${OUT}" stroke-width="4" stroke-linecap="round"/>
  <path d="M22 70c2-9 10-14 20-11" fill="none" stroke="#fff6c4" stroke-width="5" stroke-linecap="round" opacity=".85"/>
  <path d="M64 15c4-2 9-1 12 1" fill="none" stroke="#fff6c4" stroke-width="4" stroke-linecap="round" opacity=".85"/>`,
  vgrad('mu-g', [
    [0, '#ffd84a'],
    [0.6, '#ffa21c'],
    [1, '#f07a00'],
  ]),
)

const pets = svg(
  `<path d="M17 40L22 8l24 22zM83 40L78 8 54 30z" fill="url(#pt-o)" stroke="${OUT}" stroke-width="5.5" stroke-linejoin="round"/>
  <path d="M24 34l2-15 11 10zM76 34l-2-15-11 10z" fill="#ffc2c9"/>
  <rect x="10" y="24" width="80" height="68" rx="18" fill="url(#pt-o)" stroke="${OUT}" stroke-width="6"/>
  <path d="M38 26l3 10M50 25v11M62 26l-3 10" stroke="#c94a00" stroke-width="5" stroke-linecap="round"/>
  <ellipse cx="50" cy="74" rx="22" ry="14" fill="#fff4e6" stroke="${OUT}" stroke-width="4"/>
  <ellipse cx="33" cy="55" rx="8" ry="10" fill="${OUT}"/><ellipse cx="67" cy="55" rx="8" ry="10" fill="${OUT}"/>
  <circle cx="30" cy="51" r="3.4" fill="#fff"/><circle cx="64" cy="51" r="3.4" fill="#fff"/>
  <path d="M45 66h10l-5 5z" fill="#ff6f8f" stroke="${OUT}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M42 76c4 4 12 4 16 0" fill="none" stroke="${OUT}" stroke-width="3.5" stroke-linecap="round"/>
  <path d="M46 78c0 9 8 9 8 0" fill="#ff5f84" stroke="${OUT}" stroke-width="3"/>
  <path d="M18 44c1-9 6-14 14-16" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" opacity=".55"/>`,
  vgrad('pt-o', [
    [0, '#ffb14a'],
    [1, '#ff7414'],
  ]),
)

const items = svg(
  `<path d="M34 22c0-14 32-14 32 0" fill="none" stroke="${OUT}" stroke-width="13" stroke-linecap="round"/>
  <path d="M34 22c0-14 32-14 32 0" fill="none" stroke="#c4192c" stroke-width="5" stroke-linecap="round"/>
  <rect x="14" y="20" width="72" height="72" rx="20" fill="url(#it-r)" stroke="${OUT}" stroke-width="6"/>
  <rect x="26" y="52" width="48" height="32" rx="9" fill="url(#it-p)" stroke="${OUT}" stroke-width="5"/>
  <path d="M26 64h48" stroke="${OUT}" stroke-width="4"/>
  <rect x="40" y="30" width="20" height="16" rx="3" fill="#fff" stroke="${OUT}" stroke-width="4"/>
  <path d="M44 34v8l6-5 6 5v-8" fill="none" stroke="#e0213b" stroke-width="3" stroke-linejoin="round"/>
  <path d="M22 40c0-8 4-12 10-13" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" opacity=".55"/>`,
  vgrad('it-r', [
    [0, '#ff6b62'],
    [1, '#d6182b'],
  ]) +
    vgrad('it-p', [
      [0, '#ff8a80'],
      [1, '#e42a3b'],
    ]),
)

const store = svg(
  `<path d="M26 44c0-34 48-34 48 0" fill="none" stroke="${OUT}" stroke-width="14" stroke-linecap="round"/>
  <path d="M26 44c0-34 48-34 48 0" fill="none" stroke="#5fc4ff" stroke-width="6" stroke-linecap="round"/>
  <path d="M8 40h84l-9 48c-1 4-4 6-8 6H25c-4 0-7-2-8-6z" fill="url(#st-y)" stroke="${OUT}" stroke-width="6" stroke-linejoin="round"/>
  <rect x="5" y="36" width="90" height="13" rx="6" fill="#ffe46b" stroke="${OUT}" stroke-width="5"/>
  <path d="M30 58v26M43 58v26M57 58v26M70 58v26" stroke="#d18a00" stroke-width="5" stroke-linecap="round"/>
  <path d="M18 66h64" stroke="#d18a00" stroke-width="4" stroke-linecap="round"/>`,
  vgrad('st-y', [
    [0, '#ffe25a'],
    [1, '#ffa412'],
  ]),
)

const calendar = svg(
  `<rect x="10" y="16" width="80" height="76" rx="12" fill="#ffffff" stroke="${OUT}" stroke-width="6"/>
  <path d="M10 28c0-7 5-12 12-12h56c7 0 12 5 12 12v12H10z" fill="url(#cl-r)" stroke="${OUT}" stroke-width="6" stroke-linejoin="round"/>
  <rect x="26" y="6" width="9" height="20" rx="4" fill="#cfd8e3" stroke="${OUT}" stroke-width="4"/>
  <rect x="65" y="6" width="9" height="20" rx="4" fill="#cfd8e3" stroke="${OUT}" stroke-width="4"/>
  <g fill="#ff9a1f"><rect x="22" y="50" width="12" height="10" rx="2"/><rect x="44" y="50" width="12" height="10" rx="2"/><rect x="66" y="50" width="12" height="10" rx="2"/><rect x="22" y="68" width="12" height="10" rx="2"/><rect x="44" y="68" width="12" height="10" rx="2" fill="#2fd14a"/><rect x="66" y="68" width="12" height="10" rx="2"/></g>`,
  vgrad('cl-r', [
    [0, '#ff6b6b'],
    [1, '#d91c3a'],
  ]),
)

/** A chunky cog for Settings. */
const settingsTeeth = Array.from({ length: 8 }, (_, i) => `<rect x="42" y="6" width="16" height="20" rx="4" transform="rotate(${i * 45} 50 50)"/>`).join('')
const settings = svg(
  `<g fill="url(#se-g)" stroke="${OUT}" stroke-width="5" stroke-linejoin="round">${settingsTeeth}<circle cx="50" cy="50" r="31"/></g>
  <g fill="url(#se-g)">${settingsTeeth}</g>
  <circle cx="50" cy="50" r="27" fill="url(#se-g)"/>
  <circle cx="50" cy="50" r="12" fill="#2c344d" stroke="${OUT}" stroke-width="5"/>
  <path d="M30 40c3-7 9-12 16-13" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".7"/>`,
  vgrad('se-g', [
    [0, '#e8eef6'],
    [1, '#9aa6b8'],
  ]),
)

const star = svg(
  `<path d="M50 8l12 25 27 4-20 19 5 27-24-13-24 13 5-27-20-19 27-4z" fill="#ffffff" stroke="${OUT}" stroke-width="6" stroke-linejoin="round"/>`,
)

/**
 * Power (the code's `health`): a chunky lightning bolt, glossy yellow with a white shine.
 * Still named `heart`, so every place that showed Health shows Power.
 */
const heart = svg(
  `<path d="M58 6L18 56h24l-8 38 48-54H56z" fill="url(#ht-g)" stroke="${OUT}" stroke-width="6" stroke-linejoin="round"/>
  <path d="M52 16L28 48" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".8"/>`,
  vgrad('ht-g', [
    [0, '#fffbd0'],
    [0.45, '#ffd21f'],
    [1, '#ff8a00'],
  ]),
)

/**
 * A football: brown leather with a soft shine, two white stripes at each end and white
 * laces along the top, tilted, in a thick ink outline. Still named `tire`, so every place
 * that showed a ball (the shop, the stands, the HUD) shows a football.
 */
const FOOTBALL = 'M5 50C19 15 81 15 95 50C81 85 19 85 5 50Z'
const tire = svg(
  `<g transform="rotate(-32 50 50)">
    <path d="${FOOTBALL}" fill="url(#fb-g)"/>
    <g clip-path="url(#fb-c)" fill="none" stroke-linecap="round">
      <g stroke="#fff" stroke-width="4">
        <path d="M23 18Q14 50 23 82"/><path d="M32 16Q24 50 32 84"/>
        <path d="M77 18Q86 50 77 82"/><path d="M68 16Q76 50 68 84"/>
      </g>
      <path d="M36 37H64" stroke="#fff" stroke-width="3.6"/>
      <path d="M41 30V44M47 30V44M53 30V44M59 30V44" stroke="#fff" stroke-width="3.2"/>
      <path d="M24 38Q36 24 54 23" stroke="#fff" stroke-width="5" opacity=".55"/>
      <path d="M22 68Q40 80 70 76" stroke="#4a2008" stroke-width="5" opacity=".28"/>
    </g>
    <path d="${FOOTBALL}" fill="none" stroke="${OUT}" stroke-width="6" stroke-linejoin="round"/>
  </g>`,
  vgrad('fb-g', [
    [0, '#d9814a'],
    [0.5, '#a65228'],
    [1, '#6e3014'],
  ]) + `<clipPath id="fb-c"><path d="${FOOTBALL}"/></clipPath>`,
)

/** A round potion flask with a cork, filled with `liquid` and a small badge icon. */
function potion(id, liquid, liquidDark, badge) {
  return svg(
    `<rect x="38" y="6" width="24" height="16" rx="4" fill="#c98a4b" stroke="${OUT}" stroke-width="5"/>
    <path d="M40 22h20v12c16 5 26 18 26 32 0 18-16 30-36 30S14 84 14 66c0-14 10-27 26-32z" fill="#e8f6ff" stroke="${OUT}" stroke-width="6" stroke-linejoin="round"/>
    <path d="M18 64c10-6 22 4 32 0s22-6 32 0c0 16-14 26-32 26S18 80 18 64z" fill="url(#${id}-l)"/>
    <path d="M24 56c2-8 8-14 16-16" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
    ${badge}`,
    vgrad(`${id}-l`, [
      [0, liquid],
      [1, liquidDark],
    ]),
  )
}

const potionWins = potion(
  'pw',
  '#4fd2ff',
  '#1565e0',
  `<path d="M38 62h24v6c0 7-5 12-12 12s-12-5-12-12z" fill="#ffd23a" stroke="${OUT}" stroke-width="3.5" stroke-linejoin="round"/>
   <rect x="42" y="80" width="16" height="6" rx="2" fill="#ffd23a" stroke="${OUT}" stroke-width="3"/>`,
)
const potionHealth = potion(
  'ph',
  '#ff8aa4',
  '#d4142a',
  `<path d="M50 84c-3-3-14-10-15-18-1-5 3-9 7-9 3 0 6 2 8 5 2-3 5-5 8-5 4 0 8 4 7 9-1 8-12 15-15 18z" fill="#ffffff" stroke="${OUT}" stroke-width="3.5" stroke-linejoin="round"/>`,
)

/** A spotted egg in the given colours. */
export function eggSvg(base, dark, spot) {
  return svg(
    `<path d="M50 6C28 6 12 40 12 62c0 20 17 32 38 32s38-12 38-32C88 40 72 6 50 6z" fill="url(#eg-g)" stroke="${OUT}" stroke-width="6"/>
    <ellipse cx="34" cy="50" rx="7" ry="9" fill="${spot}"/><ellipse cx="62" cy="34" rx="6" ry="7" fill="${spot}"/>
    <ellipse cx="66" cy="68" rx="9" ry="8" fill="${spot}"/><ellipse cx="44" cy="80" rx="5" ry="4" fill="${spot}"/>
    <path d="M26 46c2-14 10-26 18-30" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".7"/>`,
    vgrad('eg-g', [
      [0, base],
      [1, dark],
    ]),
  )
}

const close = svg(
  `<path d="M24 24l52 52M76 24L24 76" stroke="${OUT}" stroke-width="22" stroke-linecap="round"/>
  <path d="M24 24l52 52M76 24L24 76" stroke="#fff" stroke-width="11" stroke-linecap="round"/>`,
)

const arrowDown = svg(
  `<path d="M36 8h28v40h20L50 90 16 48h20z" fill="#ffffff" stroke="${OUT}" stroke-width="6" stroke-linejoin="round"/>`,
)

const check = svg(
  `<path d="M16 52l22 22 46-48" fill="none" stroke="${OUT}" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M16 52l22 22 46-48" fill="none" stroke="#5cf064" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`,
)

const portal = svg(
  `<circle cx="50" cy="50" r="42" fill="url(#po-g)" stroke="${OUT}" stroke-width="6"/>
  <path d="M50 50c0-10 14-10 14 0 0 16-28 16-28 0 0-22 42-22 42 0 0 28-56 28-56 0" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/>`,
  `<radialGradient id="po-g"><stop offset="0" stop-color="#b8f3ff"/><stop offset="1" stop-color="#2f7fe6"/></radialGradient>`,
)

const starGold = svg(
  `<path d="M50 6l13 27 29 4-21 20 5 29-26-14-26 14 5-29L8 37l29-4z" fill="url(#sg-g)" stroke="${OUT}" stroke-width="6" stroke-linejoin="round"/>
  <path d="M38 30l7-13" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".75"/>`,
  vgrad('sg-g', GOLD),
)

const fastForward = svg(
  `<path d="M8 18l40 32-40 32z" fill="url(#ff-g)" stroke="${OUT}" stroke-width="6" stroke-linejoin="round"/>
  <path d="M50 18l40 32-40 32z" fill="url(#ff-g)" stroke="${OUT}" stroke-width="6" stroke-linejoin="round"/>`,
  vgrad('ff-g', [
    [0, '#ffffff'],
    [1, '#9fdcff'],
  ]),
)

const SPEAKER = `<path d="M14 38h16l22-18v60L30 62H14z" fill="url(#sp-g)" stroke="${OUT}" stroke-width="6" stroke-linejoin="round"/>
  <path d="M20 44h8" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".7"/>`
const SPEAKER_GRADIENT = vgrad('sp-g', [
  [0, '#ffffff'],
  [1, '#c7d3e3'],
])

const sound = svg(
  `${SPEAKER}
  <path d="M62 38c6 7 6 17 0 24M72 30c11 11 11 29 0 40" fill="none" stroke="${OUT}" stroke-width="12" stroke-linecap="round"/>
  <path d="M62 38c6 7 6 17 0 24M72 30c11 11 11 29 0 40" fill="none" stroke="#7fe2ff" stroke-width="5" stroke-linecap="round"/>`,
  SPEAKER_GRADIENT,
)

const soundOff = svg(
  `${SPEAKER}
  <path d="M62 38l22 24M84 38L62 62" stroke="${OUT}" stroke-width="13" stroke-linecap="round"/>
  <path d="M62 38l22 24M84 38L62 62" stroke="#ff5a5a" stroke-width="6" stroke-linecap="round"/>`,
  SPEAKER_GRADIENT,
)

export const ICON_SVGS = {
  sound,
  soundOff,
  starGold,
  fastForward,
  trophy,
  muscle,
  pets,
  items,
  store,
  calendar,
  star,
  settings,
  heart,
  tire,
  potionWins,
  potionHealth,
  close,
  arrowDown,
  check,
  portal,
}

/** Egg colours by egg id, shared by the icons and the 3D eggs. */
export const EGG_COLORS = {
  basic: ['#ffffff', '#cdd6e2', '#e2e8f0'],
  // Bottle Tumble's eggs.
  sprout: ['#d4ffdc', '#3fbf5f', '#eafff0'],
  frost: ['#eaf7ff', '#5cb8f0', '#ffffff'],
  cosmic: ['#c9b8ff', '#4c1d95', '#f0abfc'],
  meadow: ['#7cf08a', '#2fae4a', '#c8ffd0'],
  sunset: ['#ffc07a', '#ff6a3d', '#ffe2b8'],
  unicorn: ['#f6eaff', '#d3b4ff', '#ffd1f0'],
  volcano: ['#5a3a30', '#2a1814', '#ff6a14'],
  // Sandy shell with blue waves, like the 3D Beach Egg (EggDisplays).
  beach: ['#fff3dc', '#2fb8e0', '#bff4ff'],
  // World 2 eggs.
  candy: ['#ffe4f1', '#f472b6', '#fde68a'],
  lava: ['#ffb37a', '#c2410c', '#fde047'],
  void: ['#a78bfa', '#2e1065', '#f0abfc'],
}

const urlCache = new Map()

/** `data:` URL for an icon name, or `egg:<id>` for an egg. */
export function iconUrl(name) {
  if (IMAGE_ICONS[name]) return IMAGE_ICONS[name]
  let url = urlCache.get(name)
  if (url) return url
  let markup = ICON_SVGS[name]
  if (!markup && name.startsWith('egg:')) {
    const colors = EGG_COLORS[name.slice(4)] || EGG_COLORS.basic
    markup = eggSvg(...colors)
  }
  if (!markup) return null
  url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
  urlCache.set(name, url)
  return url
}
