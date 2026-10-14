import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { listOwnerBookings } from '@/api/ownerBookings'
import type { OwnerBookingView } from '@/api/types'
import { formatMoney } from '@/lib/format'
import { Button } from '@/components/ui/Button'

interface OwnerAnalyticsSectionProps {
  businessId: string
  businessSlug: string
  currency?: string
}

export function OwnerAnalyticsSection({
  businessId,
  businessSlug,
  currency = 'ETB',
}: OwnerAnalyticsSectionProps) {
  const [bookings, setBookings] = useState<OwnerBookingView[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listOwnerBookings(businessId)
      .then((data) => {
        if (!cancelled) {
          setBookings(data)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [businessId])

  const stats = useMemo(() => {
    const total = bookings.length
    const confirmed = bookings.filter((b) => b.status === 'CONFIRMED').length
    const pendingReview = bookings.filter((b) => b.status === 'PAYMENT_PENDING').length
    const totalRevenueMinor = bookings
      .filter((b) => b.status === 'CONFIRMED')
      .reduce((acc, b) => acc + (b.totalPriceMinor || 0), 0)

    const hourly = new Array(24).fill(0)
    for (const b of bookings) {
      if (b.startAt) {
        try {
          const hour = new Date(b.startAt).getHours()
          if (hour >= 0 && hour < 24) {
            hourly[hour]++
          }
        } catch {
          // Ignore invalid dates
        }
      }
    }

    const maxHourly = Math.max(...hourly, 1)
    let peakHourIndex = 0
    let maxCount = 0
    hourly.forEach((count, h) => {
      if (count > maxCount) {
        maxCount = count
        peakHourIndex = h
      }
    })

    return {
      total,
      confirmed,
      pendingReview,
      totalRevenueMinor,
      hourly,
      maxHourly,
      peakHourIndex,
      peakHourCount: maxCount,
    }
  }, [bookings])

  const publicUrl = `${window.location.origin}/p/${businessSlug}`

  const handleCopyLink = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(publicUrl).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
    }
  }

  const formatHourLabel = (h: number) => {
    const period = h >= 12 ? 'PM' : 'AM'
    const displayH = h % 12 === 0 ? 12 : h % 12
    return `${displayH}:00 ${period}`
  }

  return (
    <section className="analytics-section" aria-labelledby="analytics-heading">
      <h2 id="analytics-heading" className="page-subtitle" style={{ marginBottom: 'var(--space-3)' }}>
        Performance &amp; Traffic • አፈጻጸምና ተመራጭ ሰዓታት
      </h2>

      {/* KPI Cards Grid */}
      <div className="analytics-kpi-grid">
        <div className="analytics-kpi-card">
          <div className="analytics-kpi-top">
            <span className="analytics-kpi-label">Total Bookings • ጠቅላላ</span>
            <div className="analytics-kpi-icon analytics-kpi-icon--blue">📅</div>
          </div>
          <div className="analytics-kpi-value">{loading ? '…' : stats.total}</div>
          <div className="analytics-kpi-sub">
            {stats.total > 0 ? `${stats.confirmed} confirmed slots` : 'No bookings recorded yet'}
          </div>
        </div>

        <div className="analytics-kpi-card">
          <div className="analytics-kpi-top">
            <span className="analytics-kpi-label">Confirmed • የተረጋገጡ</span>
            <div className="analytics-kpi-icon analytics-kpi-icon--green">✓</div>
          </div>
          <div className="analytics-kpi-value">{loading ? '…' : stats.confirmed}</div>
          <div className="analytics-kpi-sub">
            {stats.total > 0
              ? `${Math.round((stats.confirmed / stats.total) * 100)}% confirmation rate`
              : '0% rate'}
          </div>
        </div>

        <div className="analytics-kpi-card">
          <div className="analytics-kpi-top">
            <span className="analytics-kpi-label">Pending Deposit Review • በመጠባበቅ ላይ</span>
            <div className="analytics-kpi-icon analytics-kpi-icon--amber">⏳</div>
          </div>
          <div className="analytics-kpi-value">
            {loading ? '…' : stats.pendingReview}
            {stats.pendingReview > 0 && (
              <span className="analytics-kpi-badge analytics-kpi-badge--alert" style={{ marginLeft: 8 }}>
                Action needed
              </span>
            )}
          </div>
          <div className="analytics-kpi-sub">
            {stats.pendingReview > 0 ? (
              <Link to="/owner/bookings" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
                Review receipts now →
              </Link>
            ) : (
              'All receipts reviewed'
            )}
          </div>
        </div>

        <div className="analytics-kpi-card">
          <div className="analytics-kpi-top">
            <span className="analytics-kpi-label">Locked Revenue • የተረጋገጠ ገቢ</span>
            <div className="analytics-kpi-icon analytics-kpi-icon--purple">💰</div>
          </div>
          <div className="analytics-kpi-value">
            {loading ? '…' : formatMoney(stats.totalRevenueMinor, currency)}
          </div>
          <div className="analytics-kpi-sub">From confirmed bookings</div>
        </div>
      </div>

      {/* 24-Hour Peak Booking Traffic Heatmap (EthioxHub feature) */}
      <div className="analytics-chart-card">
        <div className="analytics-chart-header">
          <h3 className="analytics-chart-title">
            <span>⏰</span> Peak Booking Hours Heatmap • ተመራጭ የደንበኞች ሰዓታት
          </h3>
          <div className="analytics-chart-legend">
            {stats.peakHourCount > 0 ? (
              <span>
                Most popular:{' '}
                <strong style={{ color: 'var(--color-primary)' }}>
                  {formatHourLabel(stats.peakHourIndex)} ({stats.peakHourCount} bookings)
                </strong>
              </span>
            ) : (
              '24-Hour booking distribution'
            )}
          </div>
        </div>

        <div className="analytics-chart-bars">
          {stats.hourly.map((count, hour) => {
            const heightPercent = stats.maxHourly > 0 ? (count / stats.maxHourly) * 100 : 0
            const displayHeight = Math.max(heightPercent, 5) // ensure at least a pill base is visible
            const isPeak = count > 0 && count === stats.peakHourCount

            return (
              <div key={hour} className="analytics-chart-col">
                <div className="analytics-chart-tooltip">
                  {formatHourLabel(hour)} — {count} {count === 1 ? 'booking' : 'bookings'}
                  {isPeak ? ' (🔥 Peak)' : ''}
                </div>
                <div
                  className="analytics-chart-bar"
                  style={{
                    height: `${displayHeight}%`,
                    background: isPeak
                      ? 'linear-gradient(to top, #f59e0b, #fbbf24)'
                      : undefined,
                  }}
                />
              </div>
            )
          })}
        </div>

        <div className="analytics-chart-labels">
          <span>12 AM</span>
          <span>3 AM</span>
          <span>6 AM</span>
          <span>9 AM</span>
          <span>12 PM</span>
          <span>3 PM</span>
          <span>6 PM</span>
          <span>9 PM</span>
          <span>11 PM</span>
        </div>
      </div>

      {/* Quick Booking Link & Share Box */}
      <div className="copy-link-card">
        <h3 className="card__title" style={{ margin: 0 }}>
          🔗 Shareable Booking Link • የቀጠሮ ማስያዣ ሊንክ
        </h3>
        <p className="card__subtitle" style={{ margin: '4px 0 0 0' }}>
          Share this link with your customers on Telegram, WhatsApp, Instagram, or SMS to receive self-service bookings.
        </p>
        <div className="copy-link-row">
          <div className="copy-link-input" title={publicUrl}>
            {publicUrl}
          </div>
          <Button
            type="button"
            variant="primary"
            className="copy-link-btn"
            onClick={handleCopyLink}
          >
            {copied ? '✓ Copied! (ተገልብጧል)' : '📋 Copy Link • ኮፒ'}
          </Button>
          <a
            className="btn btn--outline"
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open public page in new tab"
          >
            ↗ Open
          </a>
        </div>
      </div>
    </section>
  )
}
