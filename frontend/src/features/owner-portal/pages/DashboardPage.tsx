import { useEffect, useState, useMemo } from 'react'
import Grid from '@mui/material/Grid'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { useOwnedBusiness } from '@/features/owner-portal/state/useOwnedBusiness'
import { LoadState } from '@/features/owner-portal/components/LoadState'
import { PauseCard } from '@/features/owner-portal/components/PauseCard'
import { TelegramOwnerCard } from '@/features/owner-portal/components/TelegramOwnerCard'
import { listOwnerBookings } from '@/api/ownerBookings'
import type { OwnerBookingView } from '@/api/types'
import { ownerBookingFromWire } from '@/features/owner-portal/lib/ownerBooking'
import type { Booking } from '@/types/models'
import { MaterioAwardCard } from '@/features/owner-portal/components/materio/MaterioAwardCard'
import { MaterioTransactionsCard } from '@/features/owner-portal/components/materio/MaterioTransactionsCard'
import { MaterioWeeklyOverviewCard } from '@/features/owner-portal/components/materio/MaterioWeeklyOverviewCard'
import { MaterioTotalEarningCard } from '@/features/owner-portal/components/materio/MaterioTotalEarningCard'
import { MaterioQuickActionsCard } from '@/features/owner-portal/components/materio/MaterioQuickActionsCard'
import { MaterioRecentBookingsTable } from '@/features/owner-portal/components/materio/MaterioRecentBookingsTable'

export function DashboardPage() {
  const { business, businessId, services, bookingsToday, loading, error, reload } =
    useOwnedBusiness()

  const [rawBookings, setRawBookings] = useState<OwnerBookingView[]>([])
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!businessId) return
    let cancelled = false
    listOwnerBookings(businessId)
      .then((data) => {
        if (!cancelled) setRawBookings(data)
      })
      .catch(() => {
        // Quiet fallback
      })
    return () => {
      cancelled = true
    }
  }, [businessId])

  const bookings: Booking[] = useMemo(() => {
    return rawBookings.map((b) => ownerBookingFromWire(b))
  }, [rawBookings])

  const stats = useMemo(() => {
    const total = rawBookings.length
    const confirmedCount = rawBookings.filter((b) => b.status === 'CONFIRMED').length
    const confirmedRate = total > 0 ? Math.round((confirmedCount / total) * 100) : 100
    const activeServices = services.filter((s) => s.isActive).length
    const totalServices = services.length

    const revenueCents = rawBookings
      .filter((b) => b.status === 'CONFIRMED')
      .reduce((acc, b) => acc + (b.totalPriceMinor || 0), 0)

    // Breakdown by payment methods
    let telebirrCents = 0
    let cbeCents = 0
    let venueCents = 0

    for (const b of bookings) {
      if (b.state === 'confirmed') {
        const amt = b.total || 0
        if (b.paymentMethod === 'telebirr') {
          telebirrCents += amt
        } else if (b.paymentMethod === 'bank-transfer') {
          cbeCents += amt
        } else {
          venueCents += amt
        }
      }
    }

    // Hourly distribution
    const hourly: Record<number, number> = {}
    for (let i = 0; i < 24; i++) hourly[i] = 0

    for (const b of rawBookings) {
      if (b.startAt) {
        try {
          const h = new Date(b.startAt).getHours()
          if (h >= 0 && h < 24) hourly[h] = (hourly[h] || 0) + 1
        } catch {
          // ignore
        }
      }
    }

    let peakH = 12
    let maxC = 0
    for (let i = 0; i < 24; i++) {
      if ((hourly[i] || 0) > maxC) {
        maxC = hourly[i] || 0
        peakH = i
      }
    }

    const peakHourStr = `${peakH % 12 === 0 ? 12 : peakH % 12}:00 ${peakH >= 12 ? 'PM' : 'AM'}`

    return {
      total,
      confirmedCount,
      confirmedRate,
      activeServices,
      totalServices,
      revenueCents,
      telebirrCents,
      cbeCents,
      venueCents,
      hourly,
      peakHourStr,
    }
  }, [rawBookings, bookings, services])

  const handleCopyLink = () => {
    if (!business) return
    const publicUrl = `${window.location.origin}/p/${business.slug}`
    if (navigator.clipboard) {
      navigator.clipboard.writeText(publicUrl).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2500)
      })
    }
  }

  return (
    <LoadState loading={loading} error={error} onRetry={reload}>
      {business && businessId && (
        <>
          <Typography
            variant="h4"
            component="h1"
            className="page-title"
            sx={{
              fontWeight: 700,
              color: 'text.primary',
              mb: 2,
              mt: 0.5,
              fontSize: { xs: '1.5rem', sm: '1.75rem' },
            }}
          >
            Dashboard
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, pb: 4 }}>
            {/* Top row: Award/Greetings Card & Transactions KPI Badges */}
            <Grid container spacing={3}>
              <Grid size={{ xs: 12, md: 5, lg: 4 }}>
                <MaterioAwardCard
                  businessName={business.name}
                  category={business.category}
                  bookingsToday={bookingsToday}
                  businessSlug={business.slug}
                  isPaused={Boolean(business.pause)}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 7, lg: 8 }}>
                <MaterioTransactionsCard
                  totalBookings={stats.total}
                  confirmedRate={stats.confirmedRate}
                  activeServicesCount={stats.activeServices}
                  totalServicesCount={stats.totalServices}
                  revenueCents={stats.revenueCents}
                  currency={business.currency}
                />
              </Grid>
            </Grid>

            {/* Middle row: Weekly Peak Chart, Total Earnings Breakdown, Quick Operations */}
            <Grid container spacing={3}>
              <Grid size={{ xs: 12, md: 6, lg: 4 }}>
                <MaterioWeeklyOverviewCard
                  hourlyDistribution={stats.hourly}
                  totalBookings={stats.total}
                  peakHourStr={stats.peakHourStr}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 6, lg: 4 }}>
                <MaterioTotalEarningCard
                  totalRevenueCents={stats.revenueCents}
                  currency={business.currency}
                  telebirrCents={stats.telebirrCents}
                  cbeCents={stats.cbeCents}
                  venueCents={stats.venueCents}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 12, lg: 4 }}>
                <MaterioQuickActionsCard
                  onCopyLink={handleCopyLink}
                  copied={copied}
                />
              </Grid>
            </Grid>

            {/* Bottom row: Recent Bookings Table */}
            <Box>
              <MaterioRecentBookingsTable
                bookings={bookings}
                currency={business.currency}
              />
            </Box>

            {/* Telegram Notifications & Business Pause Controls */}
            <Grid container spacing={3}>
              <Grid size={{ xs: 12, md: 6 }}>
                <TelegramOwnerCard businessId={businessId} />
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <PauseCard businessId={businessId} business={business} onChanged={reload} />
              </Grid>
            </Grid>
          </Box>
        </>
      )}
    </LoadState>
  )
}