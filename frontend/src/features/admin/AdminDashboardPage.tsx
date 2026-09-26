import { Link } from 'react-router-dom'
import { useAuth } from '@/features/auth/useAuth'

interface SectionCard {
  to: string
  title: string
  body: string
  superAdminOnly?: boolean
}

const SECTIONS: SectionCard[] = [
  {
    to: '/admin/subscriptions',
    title: 'Subscription review',
    body: 'Approve or reject owner payment proofs; approval activates/extends a 30-day period (REQ-137/138).',
  },
  {
    to: '/admin/security',
    title: 'Security history',
    body: 'Login, lockout, recovery and administrative events. Super Admin sees the platform-wide history (REQ-202/203).',
  },
  {
    to: '/admin/admins',
    title: 'Admin accounts',
    body: 'Create, deactivate and reset the two platform Admin accounts (REQ-217/219).',
    superAdminOnly: true,
  },
  {
    to: '/admin/recovery',
    title: 'Emergency recovery',
    body: 'Issue a one-time recovery code to the Super Admin recovery email and set a new password (REQ-198–200).',
    superAdminOnly: true,
  },
]

/**
 * Platform administration landing page (spec §27.3). Purely navigational — all
 * capabilities are enforced by the backend on the target routes.
 */
export function AdminDashboardPage() {
  const { principal } = useAuth()
  const isSuperAdmin = principal?.role === 'SUPER_ADMIN'
  const sections = SECTIONS.filter((section) => !section.superAdminOnly || isSuperAdmin)

  return (
    <div className="admin-dashboard">
      <h1 className="page-title">Platform administration</h1>
      <p className="page-subtitle">
        Signed in as {principal?.email ?? 'an administrator'} (
        {isSuperAdmin ? 'Super Admin' : 'Admin'}). Exactly one Super Admin and two
        Admins exist on the platform.
      </p>

      <ul className="admin-cards">
        {sections.map((section) => (
          <li key={section.to} className="card card--padded admin-card">
            <h2 className="admin-card__title">
              <Link to={section.to}>{section.title}</Link>
            </h2>
            <p className="admin-card__body">{section.body}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
