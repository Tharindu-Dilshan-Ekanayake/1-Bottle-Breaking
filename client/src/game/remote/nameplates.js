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

const slots = Array.from({ length: NAMEPLATE_NODES }, () => ({ el: null, name: null, bubble: null, text: '', said: '' }))

/** Called once by the Nameplates component with its pre-rendered nodes. */
export function registerNameplateNodes(nodes) {
  nodes.forEach((el, i) => {
    const slot = slots[i]
    if (!slot) return
    slot.el = el
    slot.bubble = el.querySelector('.chat-bubble')
    slot.name = el.querySelector('.nameplate-name')
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
    if (slot.el.style.opacity !== '0') slot.el.style.opacity = '0'
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
  slot.el.style.opacity = opacity.toFixed(2)
  slot.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`
}

export function hideNameplatesFrom(index) {
  for (let i = index; i < NAMEPLATE_POOL_SIZE; i += 1) placeNameplate(i, '', null)
}
