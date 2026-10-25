import Card from '@mui/material/Card'
import CardHeader from '@mui/material/CardHeader'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import Avatar from '@mui/material/Avatar'
import Chip from '@mui/material/Chip'
import Button from '@mui/material/Button'
import { Link as RouterLink } from 'react-router-dom'
import type { Booking } from '@/types/models'
import { formatMoney } from '@/lib/format'
import { BOOKING_STATE_LABEL } from '@/features/owner-portal/lib/labels'

interface MaterioRecentBookingsTableProps {
  bookings: readonly Booking[]
  currency: string
}

const AVATAR_IMAGES = [
  '/images/avatars/1.png',
  '/images/avatars/2.png',
  '/images/avatars/3.png',
  '/images/avatars/4.png',
  '/images/avatars/5.png',
  '/images/avatars/6.png',
  '/images/avatars/7.png',
  '/images/avatars/8.png',
]

export function MaterioRecentBookingsTable({ bookings, currency }: MaterioRecentBookingsTableProps) {
  const getStatusColor = (state: Booking['state']): 'success' | 'warning' | 'error' | 'info' | 'default' => {
    switch (state) {
      case 'confirmed':
        return 'success'
      case 'payment-pending':
        return 'warning'
      case 'cancelled':
      case 'rejected':
      case 'no-show':
        return 'error'
      case 'completed':
        return 'info'
      default:
        return 'default'
    }
  }

  return (
    <Card>
      <CardHeader
        title="Recent Appointments"
        subheader="Live customer booking requests and confirmed appointments"
        action={
          <Button
            component={RouterLink}
            to="/owner/bookings"
            size="small"
            variant="outlined"
            endIcon={<i className="ri-arrow-right-line" />}
          >
            View All ({bookings.length})
          </Button>
        }
      />
      <TableContainer sx={{ overflowX: 'auto' }}>
        <Table sx={{ minWidth: 650 }}>
          <TableHead>
            <TableRow>
              <TableCell>Customer</TableCell>
              <TableCell>Service</TableCell>
              <TableCell>Appointment Date & Time</TableCell>
              <TableCell>Total (ETB)</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Action</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {bookings.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
                  No bookings yet. Share your public booking link to start receiving client appointments!
                </TableCell>
              </TableRow>
            ) : (
              bookings.slice(0, 5).map((b, index) => {
                const avatarSrc = AVATAR_IMAGES[index % AVATAR_IMAGES.length]
                const serviceName = b.lineItems[0]?.name ?? 'Standard Service'

                return (
                  <TableRow
                    key={b.id}
                    hover
                    sx={{
                      '&:last-child td, &:last-child th': { border: 0 },
                      transition: 'background-color 0.15s ease',
                    }}
                  >
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Avatar
                          src={avatarSrc}
                          alt={b.customer.name}
                          sx={{ width: 38, height: 38, border: '1px solid rgba(231, 227, 252, 0.15)' }}
                        />
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
                            {b.customer.name}
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            {b.customer.phone}
                          </Typography>
                        </Box>
                      </Box>
                    </TableCell>

                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 500, color: 'text.primary' }}>
                        {serviceName}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                        {b.totalDurationMinutes} mins
                      </Typography>
                    </TableCell>

                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 500, color: 'text.primary' }}>
                        {b.date}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        at {b.time}
                      </Typography>
                    </TableCell>

                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 700, color: 'primary.light' }}>
                        {formatMoney(b.total, currency)}
                      </Typography>
                    </TableCell>

                    <TableCell>
                      <Chip
                        label={BOOKING_STATE_LABEL[b.state] ?? b.state}
                        size="small"
                        color={getStatusColor(b.state)}
                        sx={{
                          fontWeight: 600,
                          fontSize: '0.72rem',
                          height: 24,
                        }}
                      />
                    </TableCell>

                    <TableCell align="right">
                      <Button
                        component={RouterLink}
                        to={`/owner/bookings/${b.id}`}
                        size="small"
                        variant="outlined"
                        sx={{
                          py: 0.5,
                          px: 1.5,
                          fontSize: '0.75rem',
                        }}
                      >
                        Inspect
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Card>
  )
}
