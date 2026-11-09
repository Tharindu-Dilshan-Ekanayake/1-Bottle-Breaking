/** Static control hints in the bottom corner. */
export function Controls() {
  const rows = [
    ['W A S D', 'move'],
    ['Space', 'jump'],
    ['Shift', 'sprint'],
    ['Right-drag', 'rotate camera'],
    ['Scroll', 'zoom'],
  ]

  return (
    <div className="pointer-events-none absolute bottom-4 left-4 z-10 rounded-xl bg-black/50 px-3 py-2 text-xs text-white/80 backdrop-blur">
      {rows.map(([key, action]) => (
        <div key={key}>
          <span className="font-semibold text-white">{key}</span> {action}
        </div>
      ))}
    </div>
  )
}

export default Controls
