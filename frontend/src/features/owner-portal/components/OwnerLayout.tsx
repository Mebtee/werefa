import { Fragment, useState, type ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import Box from '@mui/material/Box'
import { ThemeModeProvider, useThemeMode } from '@/theme/ThemeModeContext'
import { useAuth } from '@/features/auth/useAuth'
import { OwnerBusinessProvider } from '@/features/owner-portal/state/OwnerBusinessProvider'
import { useOwnerBusinessContext } from '@/features/owner-portal/state/OwnerBusinessContext'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { SubscriptionWarning } from './SubscriptionWarning'
import { MaterioSidebar } from './materio/MaterioSidebar'
import { MaterioNavbar } from './materio/MaterioNavbar'

function BusinessSelection({ onSelect }: { onSelect: (businessId: string) => void }) {
  const { businesses } = useOwnerBusinessContext()
  return (
    <section className="owner-business-picker" aria-labelledby="owner-business-picker-title">
      <h1 className="page-title" id="owner-business-picker-title">
        Choose a business
      </h1>
      <p className="page-subtitle">
        Select the business you want to manage. Subscription and operational data stay isolated by
        this choice.
      </p>
      <div className="owner-business-picker__list">
        {businesses.map((business) => (
          <button
            key={business.id}
            type="button"
            className="owner-business-picker__option"
            onClick={() => onSelect(business.id)}
          >
            <span className="owner-business-picker__name">{business.name}</span>
            <span className="owner-business-picker__meta">
              {business.address ?? 'Location not set'} · {business.category.label}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

function OwnerLayoutInner({ children }: { children?: ReactNode }) {
  const { principal, logout } = useAuth()
  const {
    businesses,
    selectedBusiness,
    loading,
    error,
    selectBusiness,
    reload,
  } = useOwnerBusinessContext()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const { mode } = useThemeMode()
  const isLight = mode === 'light'

  const creatingBusiness = location.pathname === '/owner/business/new'
  const subscriptionPage = location.pathname === '/owner/subscription'
  const selectionRequired = businesses.length > 1 && !selectedBusiness

  if (!principal) return <Navigate to="/owner/login" replace />

  return (
    <Box
      className="owner-shell"
      sx={{
        display: 'flex',
        minHeight: '100vh',
        bgcolor: isLight ? '#F4F5FA' : '#28243D',
        transition: 'background-color 0.2s ease',
      }}
    >
      {/* Desktop Sidebar (Permanent, 260px) */}
      <Box
        sx={{
          display: { xs: 'none', md: 'block' },
          width: 260,
          flexShrink: 0,
          height: '100vh',
          position: 'sticky',
          top: 0,
          zIndex: 1200,
          bgcolor: isLight ? '#FFFFFF' : '#312D4B',
          transition: 'background-color 0.2s ease',
        }}
      >
        <MaterioSidebar selectedBusiness={selectedBusiness} />
      </Box>

      {/* Mobile Sidebar (Slide-over Drawer) */}
      {mobileOpen && (
        <Box
          sx={{
            display: { xs: 'block', md: 'none' },
            position: 'fixed',
            inset: 0,
            zIndex: 1300,
          }}
        >
          {/* Backdrop */}
          <Box
            onClick={() => setMobileOpen(false)}
            sx={{
              position: 'fixed',
              inset: 0,
              bgcolor: 'rgba(0, 0, 0, 0.65)',
              backdropFilter: 'blur(4px)',
            }}
          />
          {/* Slide drawer panel */}
          <Box
            sx={{
              position: 'fixed',
              top: 0,
              bottom: 0,
              left: 0,
              width: 260,
              bgcolor: isLight ? '#FFFFFF' : '#312D4B',
              borderRight: isLight ? '1px solid rgba(46, 38, 61, 0.12)' : '1px solid rgba(231, 227, 252, 0.12)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              zIndex: 1301,
            }}
          >
            <MaterioSidebar
              selectedBusiness={selectedBusiness}
              onCloseMobile={() => setMobileOpen(false)}
            />
          </Box>
        </Box>
      )}

      {/* Main Content Area */}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <MaterioNavbar
          principal={principal}
          businesses={businesses}
          selectedBusiness={selectedBusiness}
          loading={loading}
          onSelectBusiness={selectBusiness}
          onToggleMobileMenu={() => setMobileOpen((prev) => !prev)}
          onLogout={logout}
        />

        <Box
          component="main"
          className="owner-main"
          sx={{
            flex: 1,
            p: { xs: 2, sm: 3, md: 4 },
            maxWidth: 1440,
            width: '100%',
            margin: '0 auto',
          }}
        >
          {loading ? (
            <div className="owner-load">
              <Spinner label="Loading businesses…" />
            </div>
          ) : error ? (
            <Alert tone="danger" title="Business workspace unavailable">
              <p>{error}</p>
              <p>Check your connection and try again.</p>
              <Button type="button" onClick={() => void reload()}>
                Retry
              </Button>
            </Alert>
          ) : businesses.length === 0 && !creatingBusiness ? (
            <Navigate to="/owner/business/new" replace />
          ) : businesses.length === 0 && creatingBusiness ? (
            <Outlet />
          ) : selectionRequired ? (
            <BusinessSelection onSelect={selectBusiness} />
          ) : (
            selectedBusiness && (
              <Fragment key={selectedBusiness.id}>
                {!subscriptionPage && <SubscriptionWarning businessId={selectedBusiness.id} />}
                {children ?? <Outlet />}
              </Fragment>
            )
          )}
        </Box>

        <Box
          component="footer"
          className="owner-footer"
          sx={{
            py: 2.5,
            px: { xs: 2, md: 4 },
            borderTop: isLight ? '1px solid rgba(46, 38, 61, 0.08)' : '1px solid rgba(231, 227, 252, 0.08)',
            color: isLight ? 'rgba(46, 38, 61, 0.6)' : 'rgba(231, 227, 252, 0.5)',
            fontSize: '0.8125rem',
            transition: 'color 0.2s ease, border-color 0.2s ease',
          }}
        >
          <div className="shell" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <p style={{ margin: 0 }}>Manage your business, schedule, bookings, and subscription in one place.</p>
            <p style={{ margin: 0 }}>Werefa owner portal</p>
          </div>
        </Box>
      </Box>
    </Box>
  )
}

export function OwnerLayout({ children }: { children?: ReactNode }) {
  return (
    <ThemeModeProvider>
      <OwnerLayoutInner>{children}</OwnerLayoutInner>
    </ThemeModeProvider>
  )
}

export function OwnerLayoutApp() {
  return (
    <OwnerBusinessProvider>
      <OwnerLayout />
    </OwnerBusinessProvider>
  )
}
