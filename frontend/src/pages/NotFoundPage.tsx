export function NotFoundPage() {
  return (
    <main className="page-root__main">
      <div className="container" style={{ paddingBlock: 'var(--space-8)' }}>
        <h1>Page not found</h1>
        <p>
          The address you tried does not exist. Werefa business pages live at{' '}
          <code>/p/&lt;booking link&gt;</code> — use the link the business gave
          you, or sign in to manage your own business.
        </p>
      </div>
    </main>
  )
}
