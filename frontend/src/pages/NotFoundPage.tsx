import { Link } from 'react-router-dom'
import { PRIMARY_BUSINESS_SLUG } from '@/mock/data'

export function NotFoundPage() {
  return (
    <main className="page-root__main">
      <div className="container" style={{ paddingBlock: 'var(--space-8)' }}>
        <h1>Page not found</h1>
        <p>
          The address you tried does not exist. Go back to{' '}
          <Link to={`/p/${PRIMARY_BUSINESS_SLUG}`}>the demo business page</Link>.
        </p>
      </div>
    </main>
  )
}