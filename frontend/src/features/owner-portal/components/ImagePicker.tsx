import { useRef, useState } from 'react'
import type { ImageAsset } from '@/types/models'

export interface ImagePickerProps {
  current: ImageAsset | null
  onSaved: (asset: ImageAsset | null) => void
  label: string
  accept?: string
  className?: string
  busy?: boolean
}

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']

/**
 * A self-contained image upload / preview / remove widget (REQ-209/REQ-208).
 *
 * - Click "Upload" opens a native file picker filtered to images.
 * - The chosen file is read as a data-URL and previewed immediately.
 * - "Remove" clears the image; "Keep" discards the unsaved selection.
 * - The actual save is deferred to the parent's explicit Save action
 *   (no auto-persist on change).
 */
export function ImagePicker({
  current,
  onSaved,
  label,
  accept = ACCEPTED_TYPES.join(','),
  className,
  busy = false,
}: ImagePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<ImageAsset | null>(null)
  const [error, setError] = useState<string | null>(null)

  const display = pending ?? current

  function handlePick() {
    setError(null)
    inputRef.current?.click()
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Unsupported file type. Use PNG, JPEG, WebP or SVG.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setPending({
        dataUrl: reader.result as string,
        alt: label,
      })
      setError(null)
    }
    reader.readAsDataURL(file)
    // reset the input so the same file can be re-picked
    e.target.value = ''
  }

  function handleSave() {
    onSaved(pending)
    setPending(null)
  }

  function handleRemove() {
    setPending(null)
    onSaved(null)
  }

  function handleDiscard() {
    setPending(null)
    setError(null)
  }

  const dirty = pending !== null

  return (
    <div className={`image-picker ${className ?? ''}`}>
      <p className="image-picker__label">{label}</p>

      {display ? (
        <img
          className="image-picker__preview"
          src={display.dataUrl}
          alt={display.alt}
        />
      ) : (
        <div className="image-picker__placeholder" aria-hidden="true">
          No image
        </div>
      )}

      <div className="image-picker__actions">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={handlePick}
          disabled={busy}
        >
          Upload
        </button>

        {dirty && (
          <>
            <button
              type="button"
              className="btn btn--accent btn--sm"
              onClick={handleSave}
              disabled={busy}
            >
              {busy ? 'Saving…' : 'Keep'}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={handleDiscard}
              disabled={busy}
            >
              Discard
            </button>
          </>
        )}

        {display && (
          <button
            type="button"
            className="btn btn--danger btn--sm"
            onClick={handleRemove}
            disabled={busy}
          >
            Remove
          </button>
        )}
      </div>

      {error && <p className="image-picker__error">{error}</p>}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={handleFile}
      />
    </div>
  )
}
