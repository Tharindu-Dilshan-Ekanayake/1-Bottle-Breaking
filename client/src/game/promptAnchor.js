/**
 * Where the proximity prompt floats: a world point the PromptProjector (inside the
 * canvas) projects to the screen every frame, moving the prompt's DOM node directly.
 * The prompt component (outside the canvas) sets the point when its target changes.
 */
export const promptAnchor = { el: null, active: false, x: 0, y: 0, z: 0 }

export function registerPromptNode(el) {
  promptAnchor.el = el
}

/** Floats the prompt over (x, y, z), or hides it with `null`. */
export function setPromptTarget(point) {
  if (!point) {
    promptAnchor.active = false
    if (promptAnchor.el) promptAnchor.el.style.opacity = '0'
    return
  }
  promptAnchor.active = true
  promptAnchor.x = point.x
  promptAnchor.y = point.y
  promptAnchor.z = point.z
}
