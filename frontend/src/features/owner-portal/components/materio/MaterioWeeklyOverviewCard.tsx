import Card from '@mui/material/Card'
import CardHeader from '@mui/material/CardHeader'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import { Link as RouterLink } from 'react-router-dom'

interface MaterioWeeklyOverviewCardProps {
  hourlyDistribution: Record<number, number>
  totalBookings: number
  peakHourStr: string
}

export function MaterioWeeklyOverviewCard({
  hourlyDistribution,
  totalBookings,
  peakHourStr,
}: MaterioWeeklyOverviewCardProps) {
  const hours = Array.from({ length: 24 }, (_, i) => i)
  const maxInHour = Math.max(1, ...Object.values(hourlyDistribution))

  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardHeader
        title="Weekly Peak Hours"
        subheader="24-hour booking distribution & customer volume"
        action={
          <Box
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              px: 1,
              py: 0.25,
              borderRadius: 1,
              backgroundColor: 'rgba(140, 87, 255, 0.12)',
              color: 'primary.light',
              fontSize: '0.75rem',
              fontWeight: 600,
            }}
          >
            Peak: {peakHourStr}
          </Box>
        }
      />
      <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <Box sx={{ mb: 2 }}>
          {/* Visual hourly bar chart matching Materio aesthetic */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: '3px',
              height: 120,
              pt: 2,
              pb: 1,
              borderBottom: '1px solid rgba(231, 227, 252, 0.1)',
            }}
          >
            {hours.map((hour) => {
              const count = hourlyDistribution[hour] || 0
              const heightPercent = totalBookings > 0 ? Math.max(6, Math.round((count / maxInHour) * 100)) : 8
              const isPeak = count === maxInHour && count > 0

              return (
                <Box
                  key={hour}
                  sx={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    height: '100%',
                    justifyContent: 'flex-end',
                    cursor: 'pointer',
                    '&:hover .bar-fill': {
                      backgroundColor: '#A379FF',
                      filter: 'drop-shadow(0 0 6px rgba(140, 87, 255, 0.8))',
                    },
                    '&:hover .bar-tooltip': {
                      opacity: 1,
                      visibility: 'visible',
                    },
                  }}
                >
                  <Box
                    className="bar-fill"
                    sx={{
                      width: '100%',
                      height: `${heightPercent}%`,
                      borderRadius: '3px 3px 0 0',
                      backgroundColor: isPeak
                        ? '#8C57FF'
                        : count > 0
                          ? 'rgba(140, 87, 255, 0.5)'
                          : 'rgba(231, 227, 252, 0.08)',
                      transition: 'all 0.2s ease',
                    }}
                  />
                </Box>
              )
            })}
          </Box>

          {/* Time axis labels */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.75, px: 0.5 }}>
            <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '0.68rem' }}>
              12 AM
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '0.68rem' }}>
              6 AM
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '0.68rem' }}>
              12 PM
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '0.68rem' }}>
              6 PM
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '0.68rem' }}>
              11 PM
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
          <Typography variant="h4" sx={{ fontWeight: 700, color: 'text.primary' }}>
            {peakHourStr}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Customer appointments cluster around mid-day hours. Adjust staffing accordingly.
          </Typography>
        </Box>

        <Button
          component={RouterLink}
          to="/owner/schedule"
          fullWidth
          variant="contained"
          color="primary"
          startIcon={<i className="ri-time-line" />}
        >
          Configure Working Schedule
        </Button>
      </CardContent>
    </Card>
  )
}
