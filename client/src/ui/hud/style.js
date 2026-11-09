/**
 * Shared HUD styling. Sizes are in reference-layout pixels (the 1920x1080 screenshots)
 * and scaled by the --px CSS variable, so the whole HUD keeps its proportions on any
 * screen.
 */

/** `u(48)` -> a CSS length equal to 48 reference pixels. */
export const u = (n) => `calc(var(--px) * ${n})`

export const GRADIENTS = {
  gold: 'linear-gradient(180deg, #fffaa8 0%, #ffd52a 45%, #ff9c00 100%)',
  goldButton: 'linear-gradient(180deg, #fff27a 0%, #ffcb1f 48%, #ff9a0a 100%)',
  blueButton: 'linear-gradient(180deg, #8ff0ff 0%, #2fb8ff 50%, #1677ff 100%)',
  purpleButton: 'linear-gradient(180deg, #ff9cf4 0%, #dc52ff 50%, #9a2bff 100%)',
  greenButton: 'linear-gradient(180deg, #b6ff6a 0%, #57e83a 50%, #19b52a 100%)',
  greyButton: 'linear-gradient(180deg, #e2e6ea 0%, #a9b0b8 55%, #7d858e 100%)',
  redButton: 'linear-gradient(180deg, #ff8a7a 0%, #ff3b3b 50%, #d4142a 100%)',
  rainbow:
    'linear-gradient(90deg, #ff3b5c 0%, #ff9a1f 18%, #ffe53b 34%, #4ef05a 50%, #2fc6ff 66%, #6a5cff 82%, #ff4fd8 100%)',
  barFill: 'linear-gradient(180deg, #ffe76b 0%, #ffc21a 50%, #ff9500 100%)',
  priceShort: 'linear-gradient(180deg, #ffc2b8 0%, #ff6a55 50%, #e2242c 100%)',
  slate: 'linear-gradient(180deg, #7c8cb0 0%, #4a5778 50%, #2c344d 100%)',
  rewardCard: 'linear-gradient(180deg, #ffe45c 0%, #ffbf1f 55%, #ff9a12 100%)',
}

/** The chunky black border every HUD button has. */
export const chunkyBorder = (width = 4) => ({
  border: `${u(width)} solid #111`,
  boxShadow: `0 ${u(4)} 0 rgba(0,0,0,0.45), inset 0 ${u(3)} 0 rgba(255,255,255,0.45)`,
})
