import { useSyncExternalStore } from 'react'

/**
 * Touch screen or not: phones, tablets and touch laptops get the joystick, JUMP and
 * "TAP" prompts.
 *
 * Known at load when the browser says so (`ontouchstart`, maxTouchPoints, a coarse
 * pointer). Some browsers and embedded frames don't, so the first real touch switches
 * it on too. `<html class="touch">` mirrors it for the CSS (the touch layout in
 * index.css).
 */

const detect = () =>
  typeof window !== 'undefined' &&
  ('ontouchstart' in window || navigator.maxTouchPoints > 0 || window.matchMedia?.('(pointer: coarse)').matches === true)

let touch = detect()
const listeners = new Set()

function setTouch(on) {
  if (touch === on) return
  touch = on
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('touch', on)
  listeners.forEach((fn) => fn())
}

if (typeof window !== 'undefined') {
  document.documentElement.classList.toggle('touch', touch)
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'touch') setTouch(true)
    },
    { passive: true, capture: true },
  )
}

/** Touch at load (kept for code that only needs the first answer). */
export const IS_TOUCH = touch

/** Is this a touch screen right now? Non-React code. */
export const isTouch = () => touch

/** React hook: true on a touch screen; re-renders when the first touch turns it on. */
export function useIsTouch() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => touch,
    () => false,
  )
}
