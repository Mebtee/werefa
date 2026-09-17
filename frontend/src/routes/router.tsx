import type { RouteObject } from 'react-router-dom'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { PRIMARY_BUSINESS_SLUG } from '@/mock/data'
import { PublicBookingPage } from '@/pages/PublicBookingPage'
import { BookingStatusPage } from '@/pages/BookingStatusPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { LoginPage } from '@/features/auth/LoginPage'
import { RequireOwner } from '@/features/auth/RequireOwner'
import { OwnerLayoutApp } from '@/features/owner-portal/components/OwnerLayout'
import { DashboardPage } from '@/features/owner-portal/pages/DashboardPage'
import { BusinessProfilePage } from '@/features/owner-portal/pages/BusinessProfilePage'
import { ServicesPage } from '@/features/owner-portal/pages/ServicesPage'
import { ServiceEditorPage } from '@/features/owner-portal/pages/ServiceEditorPage'
import { SchedulePage } from '@/features/owner-portal/pages/SchedulePage'
import { BookingsPage } from '@/features/owner-portal/pages/BookingsPage'
import { BookingDetailPage } from '@/features/owner-portal/pages/BookingDetailPage'

/**
 * Route tree.
 *
 * Public surface (this phase): the business page lives at /p/:slug. Customers
 * remain unauthenticated (REQ-040).
 * The owner surface (/owner/*) requires a real backend Owner session (Prompt
 * 44): unauthenticated visitors are redirected to /owner/login. Admin
 * (/admin/*) and super-admin (/super-admin/*) surfaces remain reserved for
 * later phases.
 */
export const appRoutes: RouteObject[] = [
  {
    path: '/',
    element: <Navigate to={`/p/${PRIMARY_BUSINESS_SLUG}`} replace />,
  },
  {
    path: '/p/:slug',
    element: <PublicBookingPage />,
  },
  {
    path: '/p/:slug/status',
    element: <BookingStatusPage />,
  },
  {
    path: '/owner/login',
    element: <LoginPage />,
  },
  {
    path: '/owner',
    element: (
      <RequireOwner>
        <OwnerLayoutApp />
      </RequireOwner>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'business', element: <BusinessProfilePage /> },
      { path: 'services', element: <ServicesPage /> },
      { path: 'services/new', element: <ServiceEditorPage /> },
      { path: 'services/:serviceId', element: <ServiceEditorPage /> },
      { path: 'schedule', element: <SchedulePage /> },
      { path: 'bookings', element: <BookingsPage /> },
      { path: 'bookings/:bookingId', element: <BookingDetailPage /> },
    ],
  },
  {
    path: '*',
    element: <NotFoundPage />,
  },
]

export function createAppRouter() {
  return createBrowserRouter(appRoutes)
}