import type { RouteObject } from 'react-router-dom'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { PRIMARY_BUSINESS_SLUG } from '@/mock/data'
import { PublicBookingPage } from '@/pages/PublicBookingPage'
import { NotFoundPage } from '@/pages/NotFoundPage'

/**
 * Route tree.
 *
 * Public surface (this phase): the business page lives at /p/:slug.
 * Route groups for the owner, admin and super-admin surfaces are reserved
 * (/owner/*, /admin/*, /super-admin/*) and will be added in later phases;
 * they are intentionally not stubbed with empty pages.
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
    path: '*',
    element: <NotFoundPage />,
  },
]

export function createAppRouter() {
  return createBrowserRouter(appRoutes)
}