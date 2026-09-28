import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Whole-app guard: no production frontend source may reach the test-only mock
 * seam, and nothing may present a fabricated business, booking or payment
 * surface at runtime.
 *
 * `src/mock/**` and `src/test/**` stay exactly as they are — a large fixture
 * library is a legitimate test asset. The invariant enforced here is that
 * production code cannot import it, so every runtime value the user sees comes
 * from the real HTTP API and PostgreSQL.
 */

const SRC = 'src'

/** Trees that are allowed to reference the mock seam. */
const SEAM_PREFIXES = ['src/mock/', 'src/test/']

const PRODUCTION_EXTENSIONS = ['.ts', '.tsx']

async function collect(dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await collect(full, out)
    } else if (PRODUCTION_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(full.replace(/\\/g, '/'))
    }
  }
  return out
}

async function productionSources(): Promise<string[]> {
  const all = await collect(SRC)
  return all.filter(
    (file) =>
      !SEAM_PREFIXES.some((prefix) => file.startsWith(prefix)) &&
      // `*.test.ts(x)` and `__tests__` are test code wherever they live.
      !/\.test\.tsx?$/.test(file) &&
      !file.includes('/__tests__/'),
  )
}

describe('no runtime mock data reaches production', () => {
  it('production sources exist (the guard is actually scanning the app)', async () => {
    const files = await productionSources()
    expect(files.length).toBeGreaterThan(50)
  })

  it('no production source imports the @/mock seam', async () => {
    const offenders: string[] = []
    for (const file of await productionSources()) {
      const text = await readFile(file, 'utf8')
      if (/from\s+['"]@\/mock\//.test(text)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })

  it('no production source imports a test file directly', async () => {
    const offenders: string[] = []
    for (const file of await productionSources()) {
      const text = await readFile(file, 'utf8')
      if (/from\s+['"]@\/test\//.test(text)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })

  it('no production source hard-codes a demo business identity', async () => {
    // These businesses existed only to back the demo UI. A public page must
    // resolve its business from the database, so an unknown slug is a 404.
    const demoSlugs = ['addis-beauty-lounge', 'marathon-auto-care', 'riverside-dry-cleaning']
    const offenders: string[] = []
    for (const file of await productionSources()) {
      const text = await readFile(file, 'utf8')
      if (demoSlugs.some((slug) => text.includes(slug))) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })

  it('no production source declares the removed demo configuration keys', async () => {
    const offenders: string[] = []
    for (const file of await productionSources()) {
      const text = await readFile(file, 'utf8')
      if (/\b(SITE_HOME_SLUG|PAYMENT_METHOD_FALLBACK)\b/.test(text)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })

  it('no production source generates a QR code client-side', async () => {
    const offenders: string[] = []
    for (const file of await productionSources()) {
      const text = await readFile(file, 'utf8')
      if (/MockQrCode|QRCode\.toDataURL|from\s+['"]qrcode['"]/.test(text)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })

  it('no production source invents payment account details', async () => {
    // The public API carries no owner-published payment instructions, so a real
    // account number can only come from a fabricated constant.
    const offenders: string[] = []
    for (const file of await productionSources()) {
      const text = await readFile(file, 'utf8')
      if (/Demo Bank|Account number:\s*\d|09[XZY]{2}\s+XXX/i.test(text)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })

  it('the test-only seam is still available to tests', async () => {
    // Guards the guard: the fixture library must not be deleted wholesale by a
    // future "no mocks" cleanup, because the test suite legitimately uses it.
    const store = await readFile('src/mock/store.ts', 'utf8')
    expect(store).toMatch(/export function/)
    const seamTest = await readFile('src/test/businessApi.ts', 'utf8')
    expect(seamTest).toMatch(/@\/mock\//)
  })

  it('the seam cannot be reached through a relative path either', async () => {
    // The `@/mock/*` alias guard is easy to bypass with `../../mock/store`, so
    // any relative specifier that walks into a seam directory also fails.
    const offenders: string[] = []
    for (const file of await productionSources()) {
      const text = await readFile(file, 'utf8')
      const specifiers = [...text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
      const escapes = specifiers.filter(
        (specifier) =>
          specifier.startsWith('.') && /(?:^|\/)(?:\.\.\/)+mock\//.test(specifier),
      )
      if (escapes.length > 0) offenders.push(`${file} -> ${escapes.join(', ')}`)
    }
    expect(offenders).toEqual([])
  })
})
