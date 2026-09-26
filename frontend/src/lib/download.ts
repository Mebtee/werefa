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
