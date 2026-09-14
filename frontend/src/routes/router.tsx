import type { RouteObject } from 'react-router-dom'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { PRIMARY_BUSINESS_SLUG } from '@/mock/data'
import { PublicBookingPage } from '@/pages/PublicBookingPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { OwnerLayoutApp } from '@/features/owner-portal/components/OwnerLayout'
import { DashboardPage } from '@/features/owner-portal/pages/DashboardPage'
import { BusinessProfilePage } from '@/features/owner-portal/pages/BusinessProfilePage'
import { ServicesPage } from '@/features/owner-portal/pages/ServicesPage'
import { ServiceEditorPage } from '@/features/owner-portal/pages/ServiceEditorPage'
import { SchedulePage } from '@/features/owner-portal/pages/SchedulePage'

/**
 * Route tree.
 *
 * Public surface (this phase): the business page lives at /p/:slug.
 * The owner surface (/owner/*) is driven by the isolated mock owner session;
 * auth is out of scope for this phase. Admin (/admin/*) and super-admin
 * (/super-admin/*) surfaces remain reserved for later phases.
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
    path: '/owner',
    element: <OwnerLayoutApp />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'business', element: <BusinessProfilePage /> },
      { path: 'services', element: <ServicesPage /> },
      { path: 'services/new', element: <ServiceEditorPage /> },
      { path: 'services/:serviceId', element: <ServiceEditorPage /> },
      { path: 'schedule', element: <SchedulePage /> },
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