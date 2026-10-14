import { NavLink } from 'react-router-dom'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import { MaterioLogo } from './MaterioLogo'
import { useThemeMode } from '@/theme/ThemeModeContext'
import type { OwnerBusinessView } from '@/api/types'

interface MaterioSidebarProps {
  selectedBusiness: OwnerBusinessView | null
  onCloseMobile?: () => void
}

interface NavItemDef {
  label: string
  to: string
  icon: string
  badge?: string
}

const mainNavItems: NavItemDef[] = [
  { label: 'Dashboard', to: '/owner', icon: 'ri-home-smile-line' },
  { label: 'Bookings', to: '/owner/bookings', icon: 'ri-calendar-check-line' },
  { label: 'Services', to: '/owner/services', icon: 'ri-scissors-2-line' },
  { label: 'Schedule', to: '/owner/schedule', icon: 'ri-time-line' },
]

const settingsNavItems: NavItemDef[] = [
  { label: 'Subscription', to: '/owner/subscription', icon: 'ri-vip-crown-line' },
  { label: 'Business', to: '/owner/business', icon: 'ri-store-2-line' },
]

export function MaterioSidebar({ selectedBusiness, onCloseMobile }: MaterioSidebarProps) {
  const { mode } = useThemeMode()
  const isLight = mode === 'light'

  return (
    <Box
      sx={{
        width: 260,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: isLight ? '#FFFFFF' : '#312D4B',
        borderRight: isLight ? '1px solid rgba(46, 38, 61, 0.12)' : '1px solid rgba(231, 227, 252, 0.12)',
        overflowY: 'auto',
        overflowX: 'hidden',
        color: isLight ? '#2E263D' : '#E7E3FC',
        py: 2,
        px: 2,
        transition: 'background-color 0.2s ease, border-color 0.2s ease',
      }}
    >
      {/* Brand Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 1,
          mb: 3,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, textDecoration: 'none' }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 38,
              height: 38,
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #8C57FF 0%, #6827EB 100%)',
              color: '#FFFFFF',
              boxShadow: '0 4px 12px rgba(140, 87, 255, 0.4)',
            }}
          >
            <MaterioLogo style={{ fontSize: 22 }} />
          </Box>
          <Box>
            <Typography
              variant="h6"
              sx={{
                fontWeight: 700,
                fontSize: '1.25rem',
                lineHeight: 1.2,
                letterSpacing: '0.15px',
                color: isLight ? '#2E263D' : '#E7E3FC',
                textTransform: 'uppercase',
              }}
            >
              Werefa
            </Typography>
            <Typography
              variant="caption"
              sx={{
                color: isLight ? 'rgba(46, 38, 61, 0.55)' : 'rgba(231, 227, 252, 0.5)',
                fontWeight: 500,
                letterSpacing: '0.4px',
                textTransform: 'uppercase',
                fontSize: '0.68rem',
              }}
            >
              Owner Workspace
            </Typography>
          </Box>
        </Box>

        {onCloseMobile && (
          <IconButton
            size="small"
            onClick={onCloseMobile}
            sx={{
              color: isLight ? 'rgba(46, 38, 61, 0.6)' : 'rgba(231, 227, 252, 0.6)',
              display: { xs: 'flex', md: 'none' },
            }}
          >
            <i className="ri-close-line" style={{ fontSize: 20 }} />
          </IconButton>
        )}
      </Box>

      {/* Navigation List */}
      <nav className="owner-nav" aria-label="Owner portal" style={{ flex: 1 }}>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* Section: Management */}
          <Box sx={{ px: 1.5, pt: 1, pb: 0.8 }}>
            <Typography
              variant="caption"
              sx={{
                color: isLight ? 'rgba(46, 38, 61, 0.45)' : 'rgba(231, 227, 252, 0.38)',
                fontWeight: 600,
                fontSize: '0.7rem',
                letterSpacing: '0.8px',
                textTransform: 'uppercase',
              }}
            >
              Management & Operations
            </Typography>
          </Box>

          {mainNavItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/owner'}
                className="owner-nav__link"
                onClick={onCloseMobile}
                style={({ isActive }) => ({
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '9px 16px',
                  borderRadius: '8px',
                  textDecoration: 'none',
                  fontSize: '0.9375rem',
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? '#FFFFFF' : isLight ? 'rgba(46, 38, 61, 0.78)' : 'rgba(231, 227, 252, 0.78)',
                  background: isActive
                    ? 'linear-gradient(270deg, rgba(140, 87, 255, 0.85) 0%, #8C57FF 100%)'
                    : 'transparent',
                  boxShadow: isActive ? '0px 4px 8px -4px rgba(140, 87, 255, 0.42)' : 'none',
                  transition: 'all 0.18s ease-in-out',
                })}
              >
                <i className={item.icon} style={{ fontSize: '1.25rem' }} />
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.badge && (
                  <Chip
                    label={item.badge}
                    size="small"
                    sx={{
                      height: 20,
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      bgcolor: '#FF4C51',
                      color: '#FFFFFF',
                    }}
                  />
                )}
              </NavLink>
            </li>
          ))}

          {/* Section: Settings */}
          <Box sx={{ px: 1.5, pt: 2.5, pb: 0.8 }}>
            <Typography
              variant="caption"
              sx={{
                color: isLight ? 'rgba(46, 38, 61, 0.45)' : 'rgba(231, 227, 252, 0.38)',
                fontWeight: 600,
                fontSize: '0.7rem',
                letterSpacing: '0.8px',
                textTransform: 'uppercase',
              }}
            >
              Preferences & Account
            </Typography>
          </Box>

          {settingsNavItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className="owner-nav__link"
                onClick={onCloseMobile}
                style={({ isActive }) => ({
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '9px 16px',
                  borderRadius: '8px',
                  textDecoration: 'none',
                  fontSize: '0.9375rem',
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? '#FFFFFF' : isLight ? 'rgba(46, 38, 61, 0.78)' : 'rgba(231, 227, 252, 0.78)',
                  background: isActive
                    ? 'linear-gradient(270deg, rgba(140, 87, 255, 0.85) 0%, #8C57FF 100%)'
                    : 'transparent',
                  boxShadow: isActive ? '0px 4px 8px -4px rgba(140, 87, 255, 0.42)' : 'none',
                  transition: 'all 0.18s ease-in-out',
                })}
              >
                <i className={item.icon} style={{ fontSize: '1.25rem' }} />
                <span style={{ flex: 1 }}>{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* Bottom Business Public Link Card */}
      {selectedBusiness && (
        <Box
          sx={{
            mt: 'auto',
            pt: 2,
          }}
        >
          <Box
            sx={{
              p: 2,
              borderRadius: '10px',
              bgcolor: isLight ? 'rgba(140, 87, 255, 0.05)' : 'rgba(140, 87, 255, 0.08)',
              border: isLight ? '1px solid rgba(140, 87, 255, 0.18)' : '1px solid rgba(140, 87, 255, 0.25)',
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className="ri-share-forward-box-line" style={{ color: '#8C57FF', fontSize: 18 }} />
              <Typography variant="body2" sx={{ fontWeight: 600, color: isLight ? '#2E263D' : '#E7E3FC' }}>
                Public Page
              </Typography>
            </Box>
            <Typography
              variant="caption"
              sx={{
                color: isLight ? 'rgba(46, 38, 61, 0.65)' : 'rgba(231, 227, 252, 0.65)',
                fontSize: '0.75rem',
              }}
            >
              Live customer booking portal
            </Typography>
            <Box sx={{ mt: 0.5 }}>
              <a
                href={`/p/${selectedBusiness.slug}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: '6px',
                  background: 'rgba(140, 87, 255, 0.14)',
                  color: '#8C57FF',
                  textDecoration: 'none',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  transition: 'all 0.15s ease-in-out',
                }}
              >
                <span>Live Page</span>
                <i className="ri-external-link-line" style={{ fontSize: 13 }} />
              </a>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  )
}
