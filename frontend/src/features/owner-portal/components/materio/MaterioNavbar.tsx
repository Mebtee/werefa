import { useState, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Avatar from '@mui/material/Avatar'
import Badge from '@mui/material/Badge'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Divider from '@mui/material/Divider'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import { ModeDropdown } from './ModeDropdown'
import { useThemeMode } from '@/theme/ThemeModeContext'
import type { AuthPrincipal, OwnerBusinessView } from '@/api/types'

interface MaterioNavbarProps {
  principal: AuthPrincipal
  businesses: readonly OwnerBusinessView[]
  selectedBusiness: OwnerBusinessView | null
  loading: boolean
  onSelectBusiness: (businessId: string) => void
  onToggleMobileMenu: () => void
  onLogout: () => void
}

export function MaterioNavbar({
  principal,
  businesses,
  selectedBusiness,
  loading,
  onSelectBusiness,
  onToggleMobileMenu,
  onLogout,
}: MaterioNavbarProps) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const open = Boolean(anchorEl)
  const { mode } = useThemeMode()
  const isLight = mode === 'light'

  const handleOpenUserMenu = (event: MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget)
  }

  const handleCloseUserMenu = () => {
    setAnchorEl(null)
  }

  return (
    <Box
      component="header"
      className="owner-header"
      sx={{
        height: 64,
        px: { xs: 2, md: 3 },
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        bgcolor: isLight ? 'rgba(255, 255, 255, 0.88)' : 'rgba(49, 45, 75, 0.85)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: isLight ? '1px solid rgba(46, 38, 61, 0.12)' : '1px solid rgba(231, 227, 252, 0.12)',
        position: 'sticky',
        top: 0,
        zIndex: 1100,
        boxShadow: isLight ? '0 2px 10px rgba(46, 38, 61, 0.06)' : '0 4px 18px rgba(0, 0, 0, 0.25)',
        transition: 'background-color 0.2s ease, border-color 0.2s ease',
      }}
    >
      {/* Left side: Hamburger (mobile) + Active business switcher */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <IconButton
          color="inherit"
          onClick={onToggleMobileMenu}
          sx={{
            display: { xs: 'flex', md: 'none' },
            color: isLight ? '#2E263D' : '#E7E3FC',
          }}
        >
          <i className="ri-menu-line" style={{ fontSize: 22 }} />
        </IconButton>

        {businesses.length > 0 && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              bgcolor: isLight ? 'rgba(46, 38, 61, 0.04)' : 'rgba(231, 227, 252, 0.06)',
              border: isLight ? '1px solid rgba(46, 38, 61, 0.12)' : '1px solid rgba(231, 227, 252, 0.14)',
              borderRadius: '8px',
              px: 1.5,
              py: 0.6,
            }}
          >
            <i className="ri-store-2-line" style={{ color: '#8C57FF', fontSize: 18 }} />
            <label className="owner-business-switcher" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
              <span style={{ fontSize: '0.78rem', color: isLight ? 'rgba(46, 38, 61, 0.65)' : 'rgba(231, 227, 252, 0.6)', fontWeight: 600 }}>
                Active business
              </span>
              <select
                value={selectedBusiness?.id ?? ''}
                disabled={loading}
                onChange={(event) => {
                  if (event.target.value) onSelectBusiness(event.target.value)
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: isLight ? '#2E263D' : '#E7E3FC',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                  outline: 'none',
                  paddingRight: '6px',
                }}
              >
                <option value="" disabled style={{ background: isLight ? '#FFFFFF' : '#312D4B', color: isLight ? '#2E263D' : '#E7E3FC' }}>
                  Select a business
                </option>
                {businesses.map((business) => (
                  <option key={business.id} value={business.id} style={{ background: isLight ? '#FFFFFF' : '#312D4B', color: isLight ? '#2E263D' : '#E7E3FC' }}>
                    {business.name}
                  </option>
                ))}
              </select>
            </label>
          </Box>
        )}
      </Box>

      {/* Right side: Public Page Link + Theme Mode Toggle + Notifications + User Profile */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 1.5 } }}>
        {/* Test assertions requirement: owner-session container with email and public link */}
        <Box className="owner-session" sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {selectedBusiness && (
            <a
              className="owner-session__public"
              href={`/p/${selectedBusiness.slug}`}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: '8px',
                color: '#8C57FF',
                background: 'rgba(140, 87, 255, 0.1)',
                border: '1px solid rgba(140, 87, 255, 0.25)',
                textDecoration: 'none',
                fontWeight: 600,
                fontSize: '0.8125rem',
                transition: 'all 0.18s ease-in-out',
              }}
            >
              <span>View public page</span>
              <i className="ri-external-link-line" style={{ fontSize: 13 }} />
            </a>
          )}

          <Typography
            component="span"
            className="owner-session__owner"
            sx={{
              display: { xs: 'none', sm: 'inline-block' },
              color: isLight ? '#2E263D' : 'rgba(231, 227, 252, 0.85)',
              fontWeight: 600,
              fontSize: '0.8125rem',
              maxWidth: 180,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {principal.email}
          </Typography>

          <button
            type="button"
            className="owner-session__signout"
            onClick={onLogout}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: '8px',
              background: 'rgba(255, 76, 81, 0.12)',
              color: '#FF4C51',
              border: '1px solid rgba(255, 76, 81, 0.28)',
              fontSize: '0.8125rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.18s ease-in-out',
            }}
          >
            <i className="ri-logout-box-r-line" style={{ fontSize: 14 }} />
            <span>Sign out</span>
          </button>
        </Box>

        {/* Theme Mode Toggle (Light/White vs Dark/Amethyst) */}
        <ModeDropdown />

        {/* Notifications Icon Button */}
        <IconButton
          sx={{
            color: isLight ? 'rgba(46, 38, 61, 0.78)' : 'rgba(231, 227, 252, 0.78)',
            '&:hover': { color: '#8C57FF', bgcolor: 'rgba(140, 87, 255, 0.08)' },
          }}
        >
          <Badge
            variant="dot"
            sx={{
              '& .MuiBadge-badge': {
                bgcolor: '#8C57FF',
                boxShadow: isLight ? '0 0 0 2px #FFFFFF' : '0 0 0 2px #312D4B',
              },
            }}
          >
            <i className="ri-notification-2-line" style={{ fontSize: 20 }} />
          </Badge>
        </IconButton>

        {/* User Avatar with Status indicator */}
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Badge
            overlap="circular"
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            badgeContent={
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: '#56CA00',
                  boxShadow: isLight ? '0 0 0 2px #FFFFFF' : '0 0 0 2px #312D4B',
                }}
              />
            }
          >
            <Avatar
              src="/images/avatars/1.png"
              alt={principal.email}
              onClick={handleOpenUserMenu}
              sx={{
                width: 36,
                height: 36,
                cursor: 'pointer',
                border: '1.5px solid rgba(140, 87, 255, 0.5)',
                transition: 'transform 0.15s ease-in-out',
                '&:hover': {
                  transform: 'scale(1.06)',
                },
              }}
            />
          </Badge>

          {/* User Profile Dropdown Menu */}
          <Menu
            anchorEl={anchorEl}
            open={open}
            onClose={handleCloseUserMenu}
            slotProps={{
              paper: {
                sx: {
                  bgcolor: isLight ? '#FFFFFF' : '#312D4B',
                  color: isLight ? '#2E263D' : '#E7E3FC',
                  border: isLight ? '1px solid rgba(46, 38, 61, 0.12)' : '1px solid rgba(231, 227, 252, 0.14)',
                  borderRadius: '10px',
                  boxShadow: isLight ? '0 10px 24px rgba(46, 38, 61, 0.12)' : '0 10px 28px rgba(0,0,0,0.45)',
                  minWidth: 230,
                  mt: 1.5,
                  p: 1,
                },
              },
            }}
            transformOrigin={{ horizontal: 'right', vertical: 'top' }}
            anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
          >
            {/* Header info */}
            <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Avatar src="/images/avatars/1.png" sx={{ width: 40, height: 40 }} />
              <Box sx={{ overflow: 'hidden' }}>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 600,
                    color: isLight ? '#2E263D' : '#E7E3FC',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {principal.email}
                </Typography>
                <Chip
                  label="Owner"
                  size="small"
                  sx={{
                    height: 18,
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    bgcolor: 'rgba(140, 87, 255, 0.14)',
                    color: '#8C57FF',
                    mt: 0.5,
                  }}
                />
              </Box>
            </Box>

            <Divider sx={{ borderColor: isLight ? 'rgba(46, 38, 61, 0.1)' : 'rgba(231, 227, 252, 0.1)', my: 1 }} />

            <MenuItem
              component={Link}
              to="/owner/business"
              onClick={handleCloseUserMenu}
              sx={{
                borderRadius: '6px',
                gap: 1.5,
                py: 1,
                color: isLight ? '#2E263D' : 'rgba(231, 227, 252, 0.85)',
                '&:hover': { bgcolor: 'rgba(140, 87, 255, 0.08)', color: '#8C57FF' },
              }}
            >
              <i className="ri-store-2-line" style={{ fontSize: 18 }} />
              <Typography variant="body2">Business Profile</Typography>
            </MenuItem>

            <MenuItem
              component={Link}
              to="/owner/subscription"
              onClick={handleCloseUserMenu}
              sx={{
                borderRadius: '6px',
                gap: 1.5,
                py: 1,
                color: isLight ? '#2E263D' : 'rgba(231, 227, 252, 0.85)',
                '&:hover': { bgcolor: 'rgba(140, 87, 255, 0.08)', color: '#8C57FF' },
              }}
            >
              <i className="ri-vip-crown-line" style={{ fontSize: 18 }} />
              <Typography variant="body2">Subscription & Plan</Typography>
            </MenuItem>

            <Divider sx={{ borderColor: isLight ? 'rgba(46, 38, 61, 0.1)' : 'rgba(231, 227, 252, 0.1)', my: 1 }} />

            {/* Sign out button matching test contract */}
            <Box sx={{ p: 0.5 }}>
              <button
                type="button"
                className="owner-session__signout"
                onClick={() => {
                  handleCloseUserMenu()
                  onLogout()
                }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '8px 16px',
                  borderRadius: '6px',
                  background: '#FF4C51',
                  color: '#FFFFFF',
                  border: 'none',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(255, 76, 81, 0.4)',
                  transition: 'background 0.18s ease',
                }}
              >
                <i className="ri-logout-box-r-line" style={{ fontSize: 16 }} />
                <span>Sign out</span>
              </button>
            </Box>
          </Menu>
        </Box>
      </Box>
    </Box>
  )
}
