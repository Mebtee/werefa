import { useEffect, useState } from 'react'

interface QuickCheckInQrProps {
  checkInUrl: string
  bookingReference: string
}

export function QuickCheckInQr({ checkInUrl, bookingReference }: QuickCheckInQrProps) {
  const [qrUrl, setQrUrl] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    async function generate() {
      try {
        const qrLib = await import('qrcode')
        const renderDataUrl = qrLib.default?.toDataURL ?? (qrLib as unknown as { toDataURL: (text: string, opts: unknown) => Promise<string> }).toDataURL
        const url = await renderDataUrl(checkInUrl, {
          width: 200,
          margin: 1,
          color: {
            dark: '#1e293b',
            light: '#ffffff',
          },
        })
        if (!cancelled) setQrUrl(url)
      } catch (err) {
        console.error('Failed to generate QR code', err)
      }
    }
    void generate()

    return () => {
      cancelled = true
    }
  }, [checkInUrl])

  return (
    <div className="checkin-qr-card">
      <div className="checkin-qr-card__badge">Scan for Quick Check-In</div>
      <div className="checkin-qr-card__code">
        {qrUrl ? (
          <img
            src={qrUrl}
            alt={`Quick check-in QR code for booking ${bookingReference}`}
            className="checkin-qr-card__img"
            width={160}
            height={160}
          />
        ) : (
          <div className="checkin-qr-card__placeholder">Generating QR code…</div>
        )}
      </div>
      <div className="checkin-qr-card__ref">
        Customer Pass: <code>{bookingReference}</code>
      </div>
      <p className="checkin-qr-card__hint">
        Show this QR code to the provider staff upon arrival for immediate check-in.
      </p>
    </div>
  )
}
