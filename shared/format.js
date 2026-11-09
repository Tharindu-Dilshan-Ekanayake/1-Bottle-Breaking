const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc']

/** 1234 -> "1.23K", 5_600_000 -> "5.6M". Integers below 1000 print as-is. */
export function fmt(value) {
  const n = Number(value) || 0
  if (Math.abs(n) < 1000) return String(Math.floor(n))
  let tier = Math.floor(Math.log10(Math.abs(n)) / 3)
  tier = Math.min(tier, SUFFIXES.length - 1)
  const scaled = n / Math.pow(1000, tier)
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2
  return `${scaled.toFixed(digits).replace(/\.0+$|(\.\d*[1-9])0+$/, '$1')}${SUFFIXES[tier]}`
}

/** 0.75 -> "+75%" */
export const pct = (fraction) => `+${Math.round(fraction * 100)}%`

/** 3.5 -> "x3.5" */
export const mult = (m) => `x${m >= 100 ? Math.round(m) : Math.round(m * 100) / 100}`
