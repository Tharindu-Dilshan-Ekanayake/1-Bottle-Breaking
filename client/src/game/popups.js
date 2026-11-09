/**
 * Floating "+12" numbers — a fixed pool of DOM nodes.
 *
 * `spawnPopup` claims the oldest slot (ring buffer); `PopupProjector` (inside the
 * Canvas) projects each live slot to screen space every frame by writing the node's
 * style directly. No React state, no allocation per popup.
 */

export const POOL_SIZE = 20
const LIFETIME = 1.1

export const popupSlots = Array.from({ length: POOL_SIZE }, () => ({
  el: null,
  active: false,
  x: 0,
  y: 0,
  z: 0,
  age: 0,
  drift: 0,
}))

let cursor = 0
let limit = POOL_SIZE

/** Quality presets cap how many popups may be alive at once. */
export function setPopupLimit(n) {
  limit = Math.max(1, Math.min(POOL_SIZE, n))
}

/** Called by the Popups component with its pre-rendered nodes. */
export function registerPopupNodes(nodes) {
  nodes.forEach((el, i) => {
    popupSlots[i].el = el
  })
}

/**
 * @param {{x:number,y:number,z:number}} pos world position
 * @param {string} text
 * @param {'power'|'trophy'|'rep'} kind
 */
export function spawnPopup(pos, text, kind = 'power') {
  const slot = popupSlots[cursor]
  cursor = (cursor + 1) % limit
  if (!slot.el) return
  slot.active = true
  slot.x = pos.x
  slot.y = pos.y
  slot.z = pos.z
  slot.age = 0
  slot.drift = (Math.random() - 0.5) * 30
  slot.el.textContent = text
  slot.el.dataset.kind = kind
}

export { LIFETIME as POPUP_LIFETIME }
