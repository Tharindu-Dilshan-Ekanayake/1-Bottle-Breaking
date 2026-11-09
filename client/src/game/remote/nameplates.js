/**
 * Name tags over other players, and chat bubbles: a fixed pool of DOM nodes positioned
 * by RemotePlayers each frame by writing their style directly (no React state in the
 * loop). Each node is `<div class="nameplate"><div class="chat-bubble"/><span/></div>`.
 *
 * The last slot (LOCAL_SLOT) belongs to your own character: it never shows a name, only
 * your latest chat bubble.
 */

export const NAMEPLATE_POOL_SIZE = 7
/** Your own bubble's slot, after the remote ones. */
export const LOCAL_SLOT = NAMEPLATE_POOL_SIZE
export const NAMEPLATE_NODES = NAMEPLATE_POOL_SIZE + 1

const slots = Array.from({ length: NAMEPLATE_NODES }, () => ({ el: null, name: null, bubble: null, text: '', said: '', x: NaN, y: NaN, opacity: '' }))

/** Called once by the Nameplates component with its pre-rendered nodes. */
export function registerNameplateNodes(nodes) {
  nodes.forEach((el, i) => {
    const slot = slots[i]
    if (!slot) return
    slot.el = el
    slot.bubble = el.querySelector('.chat-bubble')
    slot.name = el.querySelector('.nameplate-name')
    // A fresh node: nothing cached about it yet.
    slot.x = NaN
    slot.y = NaN
    slot.opacity = ''
  })
}

/**
 * Shows tag `index` with `text` (and chat `bubble`, or null) at screen (x, y), or hides
 * it when `x` is null.
 */
export function placeNameplate(index, text, x, y, opacity = 1, bubble = null) {
  const slot = slots[index]
  if (!slot?.el) return
  if (x === null) {
    if (slot.opacity !== '0') {
      slot.opacity = '0'
      slot.el.style.opacity = '0'
    }
    return
  }
  if (slot.text !== text) {
    slot.text = text
    if (slot.name) {
      slot.name.textContent = text
      slot.name.style.display = text ? '' : 'none'
    }
  }
  const said = bubble || ''
  if (slot.said !== said && slot.bubble) {
    slot.said = said
    slot.bubble.textContent = said
    slot.bubble.style.display = said ? '' : 'none'
  }
  // Only touch the DOM when something visibly changed (a still tag costs nothing).
  const o = opacity.toFixed(2)
  if (slot.opacity !== o) {
    slot.opacity = o
    slot.el.style.opacity = o
  }
  // (Written as "not close", so a fresh slot's NaN position always counts as moved.)
  if (!(Math.abs(x - slot.x) < 0.25 && Math.abs(y - slot.y) < 0.25)) {
    slot.x = x
    slot.y = y
    slot.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`
  }
}

export function hideNameplatesFrom(index) {
  for (let i = index; i < NAMEPLATE_POOL_SIZE; i += 1) placeNameplate(i, '', null)
}
