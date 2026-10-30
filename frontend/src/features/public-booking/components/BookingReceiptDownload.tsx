import { useState } from 'react'
import { DownloadIcon, ReceiptIcon } from '@/components/ui/icons'

interface BookingReceiptDownloadProps {
  businessName: string
  businessSlug: string
  businessPhone?: string
  customerName: string
  customerPhone: string
  serviceName?: string
  date?: string
  time?: string
  priceText?: string
  pendingPayment: boolean
  checkInUrl: string
}

export function BookingReceiptDownload({
  businessName,
  businessSlug,
  businessPhone,
  customerName,
  customerPhone,
  serviceName,
  date,
  time,
  priceText,
  pendingPayment,
  checkInUrl,
}: BookingReceiptDownloadProps) {
  const [generating, setGenerating] = useState(false)

  const handleDownload = async () => {
    setGenerating(true)
    try {
      const { default: jsPDF } = await import('jspdf')
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      })

      const displayBusiness = businessName || businessSlug.replace(/-/g, ' ').toUpperCase()
      const clientName = customerName || 'Valued Customer'
      const clientPhone = customerPhone.trim()

      // Header Banner Background
      doc.setFillColor(30, 41, 59) // Deep slate #1e293b
      doc.rect(0, 0, 210, 40, 'F')

      // Accent color bar
      doc.setFillColor(79, 70, 229) // Indigo #4f46e5
      doc.rect(0, 40, 210, 3, 'F')

      // Brand / Business Name
      doc.setTextColor(255, 255, 255)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(20)
      doc.text(displayBusiness, 15, 20)

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(203, 213, 225) // Slate 300
      doc.text('OFFICIAL APPOINTMENT RECEIPT', 15, 28)
      doc.text(`Issued: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}`, 15, 34)

      // Verified watermark / badge
      doc.setTextColor(199, 210, 254) // Indigo 200
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.text('WEREFA VERIFIED', 155, 22)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(148, 163, 184)
      doc.text('werefa.app', 155, 28)

      // Main Content Box
      let y = 55

      // Section: Appointment Details
      doc.setFillColor(248, 250, 252) // #f8fafc
      doc.setDrawColor(226, 232, 240) // #e2e8f0
      doc.roundedRect(15, y, 180, 52, 3, 3, 'FD')

      doc.setTextColor(79, 70, 229)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(12)
      doc.text('APPOINTMENT DETAILS', 20, y + 10)

      doc.setTextColor(100, 116, 139) // Slate 500
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)

      doc.text('Service:', 20, y + 20)
      doc.text('Date:', 20, y + 28)
      doc.text('Time:', 20, y + 36)
      doc.text('Total Amount:', 20, y + 44)

      doc.setTextColor(15, 23, 42) // Slate 900
      doc.setFont('helvetica', 'bold')
      doc.text(serviceName || 'Scheduled Service', 60, y + 20)
      doc.text(date || 'Scheduled Date', 60, y + 28)
      doc.text(time || 'Scheduled Time', 60, y + 36)
      doc.text(priceText || 'Standard Rate', 60, y + 44)

      // Status pill on the right
      doc.setFontSize(10)
      if (pendingPayment) {
        doc.setFillColor(254, 243, 199) // amber-100
        doc.roundedRect(125, y + 16, 60, 12, 2, 2, 'F')
        doc.setTextColor(180, 83, 9) // amber-700
        doc.text('DEPOSIT PENDING', 130, y + 24)
      } else {
        doc.setFillColor(220, 252, 231) // green-100
        doc.roundedRect(125, y + 16, 60, 12, 2, 2, 'F')
        doc.setTextColor(21, 128, 61) // green-700
        doc.text('CONFIRMED', 137, y + 24)
      }

      y += 62

      // Section: Client & Provider Contact
      doc.setFillColor(248, 250, 252)
      doc.roundedRect(15, y, 180, 45, 3, 3, 'FD')

      doc.setTextColor(79, 70, 229)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(12)
      doc.text('CONTACT INFORMATION', 20, y + 10)

      doc.setTextColor(100, 116, 139)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)

      doc.text('Client Name:', 20, y + 20)
      doc.text('Client Phone:', 20, y + 28)
      doc.text('Service Provider:', 20, y + 36)

      doc.setTextColor(15, 23, 42)
      doc.setFont('helvetica', 'bold')
      doc.text(clientName, 60, y + 20)
      doc.text(clientPhone, 60, y + 28)
      doc.text(displayBusiness, 60, y + 36)

      if (businessPhone) {
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(100, 116, 139)
        doc.text('Provider Phone:', 120, y + 36)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(15, 23, 42)
        doc.text(businessPhone, 155, y + 36)
      }

      y += 55

      // Section: Check-In QR Code & Instructions
      doc.setFillColor(255, 255, 255)
      doc.setDrawColor(203, 213, 225)
      doc.roundedRect(15, y, 180, 56, 3, 3, 'FD')

      try {
        const qrModule = await import('qrcode')
        const renderDataUrl = qrModule.default?.toDataURL ?? (qrModule as unknown as { toDataURL: (t: string, o: unknown) => Promise<string> }).toDataURL
        const qrDataUrl = await renderDataUrl(checkInUrl, {
          width: 160,
          margin: 1,
          color: { dark: '#1e293b', light: '#ffffff' },
        })
        doc.addImage(qrDataUrl, 'PNG', 22, y + 6, 44, 44)
      } catch {
        // Fallback placeholder if QR generation fails
        doc.setFillColor(241, 245, 249)
        doc.rect(22, y + 6, 44, 44, 'F')
      }

      doc.setTextColor(15, 23, 42)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(12)
      doc.text('SPEEDY CHECK-IN SCANNER', 74, y + 15)

      doc.setFont('helvetica', 'normal')
      doc.setTextColor(100, 116, 139)
      doc.setFontSize(9)
      doc.text('Show this QR code at the reception desk when you arrive.', 74, y + 23)
      doc.text('Your appointment is looked up instantly by the receptionist.', 74, y + 29)

      doc.setFillColor(238, 242, 255) // Indigo-50
      doc.roundedRect(74, y + 35, 112, 12, 2, 2, 'F')
      doc.setTextColor(79, 70, 229)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.text('ARRIVAL NOTICE: Please arrive 5 minutes before scheduled time.', 78, y + 42)

      y += 68

      // Footer
      doc.setDrawColor(226, 232, 240)
      doc.line(15, y, 195, y)

      doc.setTextColor(148, 163, 184)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.text('Werefa — Modern Appointment Scheduling & Queue Management for Ethiopian Businesses', 15, y + 7)
      doc.text('Support & Verification: https://werefa.app', 15, y + 12)

      const safeDate = (date || 'appointment').replace(/\s+/g, '_')
      const fileName = `Receipt_${businessSlug}_${safeDate}.pdf`
      doc.save(fileName)
    } catch (err) {
      console.error('Failed to generate PDF receipt:', err)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="receipt-download-card">
      <div className="receipt-download-info">
        <span className="receipt-download-icon" aria-hidden="true">
          <ReceiptIcon size={24} />
        </span>
        <div className="receipt-download-text">
          <div className="receipt-download-title">Download PDF Receipt</div>
          <p className="receipt-download-subtitle">
            Get an official printable receipt with QR check-in & provider details.
          </p>
        </div>
      </div>
      <button
        type="button"
        className="receipt-download-btn"
        onClick={handleDownload}
        disabled={generating}
        aria-label="Download PDF receipt"
      >
        <DownloadIcon size={18} />
        <span>{generating ? 'Generating PDF…' : 'Download Receipt (PDF)'}</span>
      </button>
    </div>
  )
}
