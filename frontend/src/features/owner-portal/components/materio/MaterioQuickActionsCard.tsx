import Card from '@mui/material/Card'
import CardHeader from '@mui/material/CardHeader'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import { Link as RouterLink } from 'react-router-dom'

interface MaterioQuickActionsCardProps {
  onCopyLink: () => void
  copied: boolean
}

export function MaterioQuickActionsCard({ onCopyLink, copied }: MaterioQuickActionsCardProps) {
  const actions = [
    {
      title: 'Business Profile',
      desc: 'Location, category, branding',
      to: '/owner/business',
      icon: 'ri-building-line',
      color: '#8C57FF',
    },
    {
      title: 'Services & Pricing',
      desc: 'Add, edit, or disable services',
      to: '/owner/services',
      icon: 'ri-scissors-2-line',
      color: '#FFB400',
    },
    {
      title: 'Working Schedule',
      desc: 'Set weekly business hours',
      to: '/owner/schedule',
      icon: 'ri-time-line',
      color: '#16B1FF',
    },
    {
      title: 'Subscription & Plans',
      desc: 'Upgrade tier and view receipts',
      to: '/owner/subscription',
      icon: 'ri-vip-crown-line',
      color: '#56CA00',
    },
  ]

  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardHeader
        title="Quick Operations"
        subheader="Fast shortcuts to manage your business"
      />
      <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
          {actions.map((action, index) => (
            <Button
              key={index}
              component={RouterLink}
              to={action.to}
              variant="outlined"
              sx={{
                justifyContent: 'flex-start',
                textAlign: 'left',
                py: 1.5,
                px: 2,
                display: 'flex',
                gap: 1.5,
                alignItems: 'center',
                borderColor: 'rgba(231, 227, 252, 0.12)',
                backgroundColor: 'rgba(231, 227, 252, 0.02)',
                '&:hover': {
                  borderColor: action.color,
                  backgroundColor: `${action.color}10`,
                },
              }}
            >
              <Box
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: `${action.color}20`,
                  color: action.color,
                  fontSize: '1.2rem',
                }}
              >
                <i className={action.icon} />
              </Box>
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary', lineHeight: 1.2 }}>
                  {action.title}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.72rem' }}>
                  {action.desc}
                </Typography>
              </Box>
            </Button>
          ))}
        </Box>

        <Box
          sx={{
            p: 2,
            borderRadius: 2,
            backgroundColor: 'rgba(140, 87, 255, 0.08)',
            border: '1px dashed rgba(140, 87, 255, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
            flexWrap: 'wrap',
          }}
        >
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
              Public Booking Link • የይፋዊ ቀጠሮ ማስያዣ
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Share with customers on Instagram, Telegram, or WhatsApp
            </Typography>
          </Box>
          <Button
            variant="contained"
            size="small"
            color="primary"
            onClick={onCopyLink}
            startIcon={<i className={copied ? 'ri-check-line' : 'ri-file-copy-line'} />}
          >
            {copied ? 'Copied!' : 'Copy Link'}
          </Button>
        </Box>
      </CardContent>
    </Card>
  )
}
