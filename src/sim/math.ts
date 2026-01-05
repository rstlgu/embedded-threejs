export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function lerp(from: number, to: number, t: number) {
  return from + (to - from) * t
}

// Replica Arduino map() (ma con float) + clamp sugli estremi.
export function mapRangeClamped(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
) {
  if (inMax === inMin) return outMin
  const t = (value - inMin) / (inMax - inMin)
  const tClamped = clamp(t, 0, 1)
  return lerp(outMin, outMax, tClamped)
}


