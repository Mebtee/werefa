import Card from '@mui/material/Card'
import CardHeader from '@mui/material/CardHeader'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Grid from '@mui/material/Grid'
import Box from '@mui/material/Box'
import Avatar from '@mui/material/Avatar'
import { formatMoney } from '@/lib/format'

interface MaterioTransactionsCardProps {
  totalBookings: number
  confirmedRate: number
  activeServicesCount: number
  totalServicesCount: number
  revenueCents: number
  currency: string
}

export function MaterioTransactionsCard({
  totalBookings,
  confirmedRate,
  activeServicesCount,
  totalServicesCount,
  revenueCents,
  currency,
}: MaterioTransactionsCardProps) {
  const statItems = [
    {
      title: 'Total Bookings',
      stats: String(totalBookings),
      subtitle: `${confirmedRate}% confirmed`,
      icon: 'ri-pie-chart-2-line',
      bgColor: 'rgba(140, 87, 255, 0.16)',
      iconColor: '#8C57FF',
    },
    {
      title: 'Active Services',
      stats: `${activeServicesCount} / ${totalServicesCount}`,
      subtitle: `${activeServicesCount} active of ${totalServicesCount} total`,
      icon: 'ri-scissors-2-line',
      bgColor: 'rgba(255, 180, 0, 0.16)',
      iconColor: '#FFB400',
    },
    {
      title: 'Confirmation Rate',
      stats: `${confirmedRate}%`,
      subtitle: 'high demand',
      icon: 'ri-checkbox-circle-line',
      bgColor: 'rgba(86, 202, 0, 0.16)',
      iconColor: '#56CA00',
    },
    {
      title: 'Locked Revenue',
      stats: formatMoney(revenueCents, currency),
      subtitle: 'confirmed deposits',
      icon: 'ri-money-dollar-circle-line',
      bgColor: 'rgba(22, 177, 255, 0.16)',
      iconColor: '#16B1FF',
    },
  ]

  return (
    <Card sx={{ height: '100%', minHeight: 220 }}>
      <CardHeader
        title="Business Metrics"
        subheader={
          <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
            <Typography variant="body2" component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>
              Real-time Performance 😎
            </Typography>
            <Typography variant="body2" component="span" sx={{ color: 'text.secondary' }}>
              updated live
            </Typography>
          </Box>
        }
      />
      <CardContent sx={{ pt: 1 }}>
        <Grid container spacing={2.5}>
          {statItems.map((item, index) => (
            <Grid size={{ xs: 6, sm: 3 }} key={index}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Avatar
                  variant="rounded"
                  sx={{
                    width: 48,
                    height: 48,
                    backgroundColor: item.bgColor,
                    color: item.iconColor,
                    fontSize: '1.4rem',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                  }}
                >
                  <i className={item.icon} />
                </Avatar>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', fontWeight: 500 }}>
                    {item.title}
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 700, color: 'text.primary', lineHeight: 1.2 }}>
                    {item.stats}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '0.72rem' }}>
                    {item.subtitle}
                  </Typography>
                </Box>
              </Box>
            </Grid>
          ))}
        </Grid>
      </CardContent>
    </Card>
  )
}
