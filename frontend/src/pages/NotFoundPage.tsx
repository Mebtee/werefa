import { Link } from 'react-router-dom'
import { SITE_HOME_SLUG } from '@/config/site'

export function NotFoundPage() {
  return (
    <main className="page-root__main">
      <div className="container" style={{ paddingBlock: 'var(--space-8)' }}>
        <h1>Page not found</h1>
        <p>
          The address you tried does not exist. Go back to{' '}
          <Link to={`/p/${SITE_HOME_SLUG}`}>the demo business page</Link>.
        </p>
      </div>
    </main>
  )
}