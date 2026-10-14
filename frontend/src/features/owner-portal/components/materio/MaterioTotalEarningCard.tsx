import Card from '@mui/material/Card'
import CardHeader from '@mui/material/CardHeader'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import Avatar from '@mui/material/Avatar'
import LinearProgress from '@mui/material/LinearProgress'
import { formatMoney } from '@/lib/format'

interface MaterioTotalEarningCardProps {
  totalRevenueCents: number
  currency: string
  telebirrCents: number
  cbeCents: number
  venueCents: number
}

export function MaterioTotalEarningCard({
  totalRevenueCents,
  currency,
  telebirrCents,
  cbeCents,
  venueCents,
}: MaterioTotalEarningCardProps) {
  const safeTotal = Math.max(1, totalRevenueCents)

  const channels = [
    {
      title: 'Telebirr',
      subtitle: 'Instant mobile wallet',
      amount: formatMoney(telebirrCents, currency),
      progress: Math.min(100, Math.round((telebirrCents / safeTotal) * 100)),
      color: '#16B1FF',
      icon: 'ri-smartphone-line',
    },
    {
      title: 'CBE Birr / Commercial Bank',
      subtitle: 'Bank transfer deposit',
      amount: formatMoney(cbeCents, currency),
      progress: Math.min(100, Math.round((cbeCents / safeTotal) * 100)),
      color: '#8C57FF',
      icon: 'ri-bank-card-line',
    },
    {
      title: 'Pay at Venue / Cash',
      subtitle: 'Completed in-person',
      amount: formatMoney(venueCents, currency),
      progress: Math.min(100, Math.round((venueCents / safeTotal) * 100)),
      color: '#56CA00',
      icon: 'ri-money-dollar-box-line',
    },
  ]

  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardHeader
        title="Total Earnings"
        subheader="Deposits and revenue breakdown by payment channel"
      />
      <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
            <Typography variant="h3" sx={{ fontWeight: 700, color: 'text.primary' }}>
              {formatMoney(totalRevenueCents, currency)}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', color: 'success.main', fontWeight: 600 }}>
              <i className="ri-arrow-up-s-line" style={{ fontSize: '1.2rem' }} />
              <Typography variant="body2" component="span" sx={{ color: 'success.main', fontWeight: 600 }}>
                100%
              </Typography>
            </Box>
          </Box>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Confirmed deposits locked in for upcoming bookings
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {channels.map((channel, index) => (
            <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Avatar
                variant="rounded"
                sx={{
                  width: 42,
                  height: 42,
                  backgroundColor: `${channel.color}20`,
                  color: channel.color,
                  fontSize: '1.3rem',
                }}
              >
                <i className={channel.icon} />
              </Avatar>
              <Box sx={{ flex: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
                      {channel.title}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                      {channel.subtitle}
                    </Typography>
                  </Box>
                  <Box sx={{ textAlign: 'right' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
                      {channel.amount}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                      {channel.progress}%
                    </Typography>
                  </Box>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={channel.progress}
                  sx={{
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: 'rgba(231, 227, 252, 0.08)',
                    '& .MuiLinearProgress-bar': {
                      backgroundColor: channel.color,
                      borderRadius: 3,
                    },
                  }}
                />
              </Box>
            </Box>
          ))}
        </Box>
      </CardContent>
    </Card>
  )
}
