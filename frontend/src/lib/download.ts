/** Triggers a client-side download of a Blob under the given filename. */
export function saveBlob(blob: Blob, fileName: string | null): void {
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName ?? 'download'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Object URL for an in-page preview (payment receipt), or `null` when the
 * environment does not implement it (jsdom in tests). Callers must render an
 * honest fallback rather than a broken image when this returns `null`.
 */
export function createObjectUrl(blob: Blob): string | null {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null
  return URL.createObjectURL(blob)
}

/** Best-effort revocation; a missing/absent URL is not an error. */
export function revokeObjectUrl(url: string | null): void {
  if (!url || typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return
  URL.revokeObjectURL(url)
}
