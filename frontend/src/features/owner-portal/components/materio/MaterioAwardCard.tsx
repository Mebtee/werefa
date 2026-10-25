import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import { Link as RouterLink } from 'react-router-dom'
import { CATEGORY_LABEL } from '@/features/owner-portal/lib/labels'
import type { BusinessCategory } from '@/types/models'

interface MaterioAwardCardProps {
  businessName: string
  category: BusinessCategory
  bookingsToday: number
  businessSlug: string
  isPaused: boolean
}

export function MaterioAwardCard({
  businessName,
  category,
  bookingsToday,
  businessSlug,
  isPaused,
}: MaterioAwardCardProps) {
  return (
    <Card sx={{ position: 'relative', overflow: 'hidden', height: '100%', minHeight: 220 }}>
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, alignItems: 'flex-start', pr: { xs: 2, sm: 14 } }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Typography variant="h5" component="h2" sx={{ fontWeight: 700, color: 'text.primary' }}>
              Welcome back! 🎉
            </Typography>
            <Chip
              label={CATEGORY_LABEL[category] ?? category}
              size="small"
              sx={{
                height: 22,
                fontSize: '0.72rem',
                backgroundColor: 'rgba(140, 87, 255, 0.16)',
                color: 'primary.light',
                border: '1px solid rgba(140, 87, 255, 0.3)',
              }}
            />
          </Box>
          <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 500 }}>
            <span className="dashboard-name">{businessName}</span> •{' '}
            <span className="dashboard-pause">
              {isPaused ? 'New bookings are paused.' : 'Open for new bookings.'}
            </span>
          </Typography>
        </Box>

        <Box sx={{ my: 0.5 }}>
          <Typography variant="h4" sx={{ fontWeight: 700, color: 'primary.light', lineHeight: 1.2 }}>
            {bookingsToday}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 600 }}>
            {bookingsToday === 1 ? 'booking' : 'bookings'} today
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.disabled', fontWeight: 500, display: 'block', mt: 0.25 }}>
            werefa.app/p/{businessSlug}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mt: 0.5 }}>
          <Button
            component={RouterLink}
            to={`/p/${businessSlug}`}
            variant="contained"
            size="small"
            color="primary"
            startIcon={<i className="ri-external-link-line" />}
          >
            Public Page
          </Button>
          <Button
            component={RouterLink}
            to="/owner/services"
            variant="outlined"
            size="small"
            startIcon={<i className="ri-scissors-2-line" />}
          >
            Services
          </Button>
        </Box>

        <Box
          component="img"
          src="/images/pages/trophy.png"
          alt="Trophy achievement"
          sx={{
            position: 'absolute',
            right: 20,
            bottom: 16,
            height: { xs: 80, sm: 108 },
            filter: 'drop-shadow(0px 8px 16px rgba(0,0,0,0.4))',
            pointerEvents: 'none',
            display: { xs: 'none', sm: 'block' },
          }}
        />
      </CardContent>
    </Card>
  )
}
