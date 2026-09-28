import type { RouteObject } from 'react-router-dom'
import { createBrowserRouter } from 'react-router-dom'
import { PublicBookingPage } from '@/pages/PublicBookingPage'
import { BookingStatusPage } from '@/pages/BookingStatusPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { LoginPage } from '@/features/auth/LoginPage'
import { RegisterPage } from '@/features/auth/RegisterPage'
import { RequireOwner } from '@/features/auth/RequireOwner'
import { RequireAdmin } from '@/features/auth/RequireAdmin'
import { RequireSuperAdmin } from '@/features/auth/RequireSuperAdmin'
import { AdminLayout } from '@/features/admin/AdminLayout'
import { AdminDashboardPage } from '@/features/admin/AdminDashboardPage'
import { AdminAccountsPage } from '@/features/admin/AdminAccountsPage'
import { SecurityHistoryPage } from '@/features/admin/SecurityHistoryPage'
import { BookingHistoryReportPage } from '@/features/admin/BookingHistoryReportPage'
import { RecoveryPage } from '@/features/admin/RecoveryPage'
import { SubscriptionReviewPage } from '@/features/admin/SubscriptionReviewPage'
import { OwnerLayoutApp } from '@/features/owner-portal/components/OwnerLayout'
import { DashboardPage } from '@/features/owner-portal/pages/DashboardPage'
import { BusinessProfilePage } from '@/features/owner-portal/pages/BusinessProfilePage'
import { CreateBusinessPage } from '@/features/owner-portal/pages/CreateBusinessPage'
import { ServicesPage } from '@/features/owner-portal/pages/ServicesPage'
import { ServiceEditorPage } from '@/features/owner-portal/pages/ServiceEditorPage'
import { SchedulePage } from '@/features/owner-portal/pages/SchedulePage'
import { BookingsPage } from '@/features/owner-portal/pages/BookingsPage'
import { BookingDetailPage } from '@/features/owner-portal/pages/BookingDetailPage'
import SubscriptionPage from '@/features/owner-portal/pages/SubscriptionPage'

/**
 * Route tree.
 *
 * Public surface: the business page lives at /p/:slug and is reachable only
 * through a real owner-configured link. There is no marketing home page and no
 * demo business in the product, so `/` is handled by the not-found route below.
 * Customers remain unauthenticated (REQ-040).
 * The owner surface (/owner/*) requires a real backend Owner session (Prompt
 * 44): unauthenticated visitors are redirected to /owner/login. The platform
 * administration surface (/admin/*, Prompt 53) requires a real Admin/Super
 * Admin session; Super-Admin-only sections are additionally guarded (REQ-137,
 * REQ-202/203/205, REQ-217/219/220, REQ-198–200).
 */
export const appRoutes: RouteObject[] = [
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
    path: '/owner/register',
    element: <RegisterPage />,
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
      { path: 'business/new', element: <CreateBusinessPage /> },
      { path: 'business', element: <BusinessProfilePage /> },
      { path: 'services', element: <ServicesPage /> },
      { path: 'services/new', element: <ServiceEditorPage /> },
      { path: 'services/:serviceId', element: <ServiceEditorPage /> },
      { path: 'schedule', element: <SchedulePage /> },
      { path: 'bookings', element: <BookingsPage /> },
      { path: 'bookings/:bookingId', element: <BookingDetailPage /> },
      { path: 'subscription', element: <SubscriptionPage /> },
    ],
  },
  {
    path: '/admin',
    element: (
      <RequireAdmin>
        <AdminLayout />
      </RequireAdmin>
    ),
    children: [
      { index: true, element: <AdminDashboardPage /> },
      { path: 'subscriptions', element: <SubscriptionReviewPage /> },
      {
        path: 'admins',
        element: (
          <RequireSuperAdmin>
            <AdminAccountsPage />
          </RequireSuperAdmin>
        ),
      },
      { path: 'security', element: <SecurityHistoryPage /> },
      {
        path: 'reports',
        element: (
          <RequireSuperAdmin>
            <BookingHistoryReportPage />
          </RequireSuperAdmin>
        ),
      },
      {
        path: 'recovery',
        element: (
          <RequireSuperAdmin>
            <RecoveryPage />
          </RequireSuperAdmin>
        ),
      },
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