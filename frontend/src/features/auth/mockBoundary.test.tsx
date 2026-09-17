import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import {
  getMockOwnedBusinessSlug,
  resetMockOwnedBusinessSlug,
  setMockOwnedBusinessSlug,
} from '@/mock/ownedBusinessFixture'
import {
  AUTHENTICATED_ADMIN,
  renderAppAt,
  UNAUTHENTICATED,
} from '@/test/auth'

const SRC = join(process.cwd(), 'src')

function productionSources(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...productionSources(full))
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes('.test.')) {
      files.push(full)
    }
  }
  return files
}

/**
 * Boundary tests proving authentication is no longer derived from the mock
 * store, while the mock *business-data* fixture remains available for the
 * not-yet-migrated domain.
 */
describe('mock/authentication boundary', () => {
  it('removed the legacy mock owner session module', () => {
    expect(existsSync(join(SRC, 'mock', 'ownerSession.ts'))).toBe(false)
  })

  it('no production source references the removed mock session', () => {
    const offenders = productionSources(SRC).filter((file) =>
      readFileSync(file, 'utf8').includes('mock/ownerSession'),
    )
    expect(offenders).toEqual([])
  })

  it('the mock business fixture is data-only and never authenticates a visitor', () => {
    setMockOwnedBusinessSlug('some-other-business')
    try {
      expect(getMockOwnedBusinessSlug()).toBe('some-other-business')
      renderAppAt('/owner', { auth: UNAUTHENTICATED })
      expect(
        screen.getByRole('heading', { name: /owner sign in/i }),
      ).toBeInTheDocument()
    } finally {
      resetMockOwnedBusinessSlug()
    }
  })

  it('keeps an Admin out of the portal regardless of mock data', () => {
    renderAppAt('/owner', { auth: AUTHENTICATED_ADMIN })
    expect(screen.getByText('Owner access only')).toBeInTheDocument()
  })
})
