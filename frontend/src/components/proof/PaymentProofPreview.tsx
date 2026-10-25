import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { toUserMessage } from '@/api/errors'
import { createObjectUrl, revokeObjectUrl, saveBlob } from '@/lib/download'
import { formatBytes } from '@/lib/format'
import { formatDateTime } from '@/lib/time'
import { cn } from '@/lib/cn'

/**
 * Shared, read-only payment-receipt preview (owner + admin review surfaces).
 *
 * It renders the ACTUAL uploaded proof, fetched through the caller's own
 * role-scoped authenticated client (`load`), so no authorization logic lives
 * here and no proof bytes are ever fetched from a public/unauthenticated URL.
 * Images render contained (never distorted) with an enlarge dialog; PDFs render
 * in the browser's native viewer with an "Open" action; everything else falls
 * back to an honest unsupported state. The enlarged view reuses the SAME object
 * URL, so the authenticated resource is loaded exactly once.
 *
 * It never fabricates metadata: only values passed in (already returned by the
 * backend) or returned by the authenticated `load`/response are displayed.
 */

/** The authenticated proof bytes plus the server-supplied content metadata. */
export interface PaymentProofFile {
  blob: Blob
  /** Real content type from the response `Content-Type` header, or null. */
  contentType: string | null
  /** Filename from `Content-Disposition`, or null. */
  fileName: string | null
}

export interface PaymentProofPreviewProps {
  /** Stable identity (e.g. the proof id); a change reloads the receipt. */
  loadKey: string
  /** Loads the authenticated proof bytes. Must reuse the role's own API client. */
  load: () => Promise<PaymentProofFile>
  /** Real proof filename already known from the projection (display only). */
  fileName?: string | null
  /** Real content type already known from the projection (display only). */
  mimeType?: string | null
  /** Real proof size already known from the projection (display only). */
  sizeBytes?: number | null
  /** Real uploaded-at instant already known from the projection (display only). */
  submittedAt?: string | null
  title?: string
  /** Download button label (owner copy differs from the admin queue copy). */
  downloadLabel?: string
}

type Status = 'loading' | 'ready' | 'error'

function baseContentType(value: string | null | undefined): string {
  return (value ?? '').split(';')[0].trim().toLowerCase()
}

export function PaymentProofPreview({
  loadKey,
  load,
  fileName,
  mimeType,
  sizeBytes,
  submittedAt,
  title = 'Payment Receipt',
  downloadLabel = 'Download',
}: PaymentProofPreviewProps) {
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState<string | null>(null)
  const [file, setFile] = useState<PaymentProofFile | null>(null)
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [enlarged, setEnlarged] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [nonce, setNonce] = useState(0)
  const modalRef = useRef<HTMLDivElement | null>(null)

  // The latest loader is read through a ref so an inline arrow from the caller
  // does not re-trigger the fetch on every render; `loadKey`/`nonce` trigger it.
  const loadRef = useRef(load)
  loadRef.current = load

  const retry = useCallback(() => setNonce((current) => current + 1), [])

  const openEnlarged = () => {
    setZoom(1)
    setRotation(0)
    setEnlarged(true)
  }

  const closeEnlarged = useCallback(() => {
    setEnlarged(false)
    setZoom(1)
    setRotation(0)
  }, [])

  const handleRotate = (e: React.MouseEvent) => {
    e.stopPropagation()
    setRotation((prev) => (prev + 90) % 360)
  }

  const handleZoomIn = (e: React.MouseEvent) => {
    e.stopPropagation()
    setZoom((prev) => Math.min(prev + 0.3, 3))
  }

  const handleZoomOut = (e: React.MouseEvent) => {
    e.stopPropagation()
    setZoom((prev) => Math.max(prev - 0.3, 0.7))
  }

  const handleZoomReset = (e: React.MouseEvent) => {
    e.stopPropagation()
    setZoom(1)
  }

  const toggleImageZoom = (e: React.MouseEvent) => {
    e.stopPropagation()
    setZoom((prev) => (prev === 1 ? 1.8 : 1))
  }

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setError(null)
    setFile(null)
    setEnlarged(false)
    setObjectUrl(null)
    loadRef
      .current()
      .then((result) => {
        if (cancelled) return
        setFile(result)
        setObjectUrl(createObjectUrl(result.blob))
        setStatus('ready')
      })
      .catch((caught) => {
        if (cancelled) return
        setError(toUserMessage(caught))
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [loadKey, nonce])

  // Revoke the previous object URL whenever it changes and on unmount.
  useEffect(() => {
    return () => revokeObjectUrl(objectUrl)
  }, [objectUrl])

  // Keyboard-accessible enlarge dialog (Escape closes; + / - zooms; R rotates).
  useEffect(() => {
    if (!enlarged) return
    modalRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeEnlarged()
      if (event.key === '+' || event.key === '=') setZoom((prev) => Math.min(prev + 0.3, 3))
      if (event.key === '-' || event.key === '_') setZoom((prev) => Math.max(prev - 0.3, 0.7))
      if (event.key === 'r' || event.key === 'R') setRotation((prev) => (prev + 90) % 360)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [enlarged, closeEnlarged])

  const contentType = baseContentType(file?.contentType ?? mimeType)
  const isImage = contentType.startsWith('image/')
  const isPdf = contentType === 'application/pdf'
  const altText = fileName ? `Payment receipt ${fileName}` : 'Payment receipt'
  const canOpenInNewTab = objectUrl !== null

  return (
    <div className="proof-preview">
      <h3 className="card__title">{title}</h3>

      <p className="proof-preview__meta">
        {submittedAt && <span>Uploaded {formatDateTime(submittedAt)}</span>}
        {contentType && <span>Type: {contentType}</span>}
        {typeof sizeBytes === 'number' && <span>{formatBytes(sizeBytes)}</span>}
      </p>

      {status === 'loading' && (
        <p className="proof-preview__state" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" /> Loading the payment receipt…
        </p>
      )}

      {status === 'error' && (
        <div className="proof-preview__state">
          <Alert tone="danger" title="Could not load the payment receipt">
            {error}
          </Alert>
          <Button type="button" variant="outline" onClick={retry}>
            Retry
          </Button>
        </div>
      )}

      {status === 'ready' && (
        <>
          {isImage && objectUrl && (
            <button
              type="button"
              className="proof-preview__thumb"
              aria-label="Open payment receipt enlarged"
              onClick={openEnlarged}
            >
              <img className="proof-preview__image" src={objectUrl} alt={altText} />
            </button>
          )}

          {isPdf && objectUrl && (
            <iframe
              className="proof-preview__frame"
              src={objectUrl}
              title={altText}
            />
          )}

          {!isImage && !isPdf && (
            <Alert tone="warning">
              This receipt type cannot be previewed in the browser. Open or
              download it to inspect the file.
            </Alert>
          )}

          {isImage && !objectUrl && (
            <Alert tone="warning">
              A preview is unavailable in this browser. Open or download the
              receipt to inspect it.
            </Alert>
          )}

          <div className="proof-preview__actions">
            {isImage && objectUrl && (
              <Button type="button" variant="outline" aria-label="Open / Enlarge" onClick={openEnlarged}>
                🔍 View Full Receipt • በሙሉ ይመልከቱ
              </Button>
            )}
            {!isImage && canOpenInNewTab && (
              <Button
                type="button"
                variant="outline"
                onClick={() => window.open(objectUrl, '_blank', 'noopener,noreferrer')}
              >
                Open receipt
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={!file}
              onClick={() => file && saveBlob(file.blob, file.fileName ?? fileName ?? null)}
            >
              {downloadLabel}
            </Button>
          </div>
        </>
      )}

      {enlarged && objectUrl && (
        <div
          className="proof-preview__modal"
          role="dialog"
          aria-modal="true"
          aria-label={altText}
          onClick={closeEnlarged}
        >
          <div className="proof-preview__lightbox-header">
            <div className="proof-preview__lightbox-title">
              🧾 {fileName || 'Receipt Slip'} {typeof sizeBytes === 'number' ? `• ${formatBytes(sizeBytes)}` : ''}
            </div>
          </div>

          <button
            type="button"
            className="proof-preview__close-round"
            onClick={closeEnlarged}
            aria-label="Close enlarged receipt"
          >
            ✕
          </button>

          <div
            ref={modalRef}
            tabIndex={-1}
            className="proof-preview__modal-body"
            onClick={(event) => event.stopPropagation()}
          >
            <img
              className={cn(
                'proof-preview__image',
                'proof-preview__image--large',
                zoom > 1 && 'is-zoomed'
              )}
              src={objectUrl}
              alt={altText}
              style={{
                transform: `scale(${zoom}) rotate(${rotation}deg)`,
              }}
              onClick={toggleImageZoom}
              title="Click to toggle zoom"
            />
          </div>

          <div
            className="proof-preview__lightbox-toolbar"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="proof-preview__tool-btn"
              onClick={handleRotate}
              title="Rotate 90 degrees (R)"
            >
              ⟳ Rotate
            </button>
            <button
              type="button"
              className="proof-preview__tool-btn"
              onClick={handleZoomOut}
              title="Zoom out (-)"
            >
              −
            </button>
            <button
              type="button"
              className="proof-preview__tool-btn"
              onClick={handleZoomReset}
              title="Reset zoom"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              className="proof-preview__tool-btn"
              onClick={handleZoomIn}
              title="Zoom in (+)"
            >
              +
            </button>
            {file && (
              <button
                type="button"
                className="proof-preview__tool-btn"
                onClick={() => saveBlob(file.blob, file.fileName ?? fileName ?? null)}
                title="Download file"
              >
                ⬇ Download
              </button>
            )}
            <button
              type="button"
              className="proof-preview__tool-btn"
              onClick={closeEnlarged}
              title="Close modal (Esc)"
            >
              ✕ Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
