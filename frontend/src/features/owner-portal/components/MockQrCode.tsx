/**
 * Deterministic pseudo-QR-code SVG mock (REQ-049). Not a real QR encoder —
 * produces a visually representative placeholder that updates when the slug
 * changes (same slug → same pattern). No external library is used.
 *
 * A real QR encoder belongs in the backend or a thin client library added
 * at a later integration stage.
 */

function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

const SIZE = 21 // classic QR version 1 is 21x21

export interface MockQrCodeProps {
  slug: string
  className?: string
  size?: number
  label?: string
}

export function MockQrCode({
  slug,
  className,
  size = 126,
  label = 'QR code',
}: MockQrCodeProps) {
  const seed = hashCode(slug)
  const cellSize = size / SIZE
  const cells: { x: number; y: number }[] = []

  // Fixed finder patterns (top-left, top-right, bottom-left corners)
  function addFinder(ox: number, oy: number) {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const ring = Math.min(r, c, 6 - r, 6 - c)
        if (ring === 0 || ring === 2) cells.push({ x: ox + c, y: oy + r })
      }
    }
  }
  addFinder(0, 0)
  addFinder(SIZE - 7, 0)
  addFinder(0, SIZE - 7)

  // Seeded pseudo-random data modules (skip fixed patterns)
  const prng = { v: seed }
  function rand() {
    prng.v = (prng.v * 1664525 + 1013904223) | 0
    return (prng.v >>> 0) / 4294967296
  }

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      // skip finder + 1-cell quiet zone
      if (r < 8 && c < 8) continue
      if (r < 8 && c >= SIZE - 8) continue
      if (r >= SIZE - 8 && c < 8) continue
      if (rand() < 0.45) cells.push({ x: c, y: r })
    }
  }

  const rects = cells
    .map(
      ({ x, y }) =>
        `<rect x="${x * cellSize}" y="${y * cellSize}" width="${cellSize}" height="${cellSize}"/>`,
    )
    .join('')

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-label={label}
      role="img"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width={size} height={size} fill="#fff" rx="4" />
      <g fill="currentColor">{rects}</g>
    </svg>
  )
}
