import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { appRoutes } from '@/routes'
import { installBusinessApiStub, OWNER_ID } from '@/test/businessApi'
import { ProofPicker } from '@/components/proof/ProofPicker'
import type { ProofFile } from '@/types/models'

/**
 * Customer-facing UI regression guards.
 *
 * Three things are pinned here, all of them properties the redesign must not
 * trade away:
 *
 *  1. An empty published catalogue renders an honest empty state and withholds
 *     the booking wizard, rather than offering invented services or an empty
 *     "add to booking" grid.
 *  2. The shared proof picker reports only what the customer's real `File`
 *     contains and enforces the same rule set the backend enforces (MIME
 *     allow-list + 5 MB cap).
 *  3. `styles/customer.css` cannot reach the Owner portal, the Admin surface,
 *     the auth screens or the marketing site — every selector in it is
 *     namespaced under `.customer-shell`.
 */

const user = userEvent.setup()
const SLUG = 'addis-beauty-lounge'

let restoreFetch: (() => void) | undefined

afterEach(() => {
  restoreFetch?.()
  restoreFetch = undefined
})

describe('public page with an empty published catalogue', () => {
  beforeEach(() => {
    document.title = ''
    restoreFetch = installBusinessApiStub(globalThis.fetch, {
      // An explicit empty list models a business that has not published any
      // active service yet (REQ-079 hides deactivated ones).
      servicesByBusinessId: { [OWNER_ID]: [] },
    }).restore
  })

  function renderPage() {
    const router = createMemoryRouter(appRoutes, { initialEntries: [`/p/${SLUG}`] })
    return render(<RouterProvider router={router} />)
  }

  it('says so plainly instead of offering a catalogue that does not exist', async () => {
    renderPage()

    // The real business still renders — an empty catalogue is not a missing one.
    expect(
      await screen.findByRole('heading', { name: 'Addis Beauty Lounge' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /no services published yet/i }),
    ).toBeInTheDocument()
  })

  it('withholds the booking wizard entirely', async () => {
    renderPage()

    await screen.findByRole('heading', { name: /no services published yet/i })
    expect(screen.queryByRole('heading', { name: 'Book now' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /add to booking/i }),
    ).not.toBeInTheDocument()
    expect(document.querySelector('.wizard')).toBeNull()
  })

  it('keeps the real ways back to the business and to a lookup', async () => {
    renderPage()

    await screen.findByRole('heading', { name: /no services published yet/i })
    expect(
      screen.getByRole('link', { name: /check my booking status/i }),
    ).toHaveAttribute('href', `/p/${SLUG}/status`)
  })
})

describe('the shared proof picker', () => {
  function Harness({ onChange }: { onChange?: (proof: ProofFile | null) => void }) {
    // Stateful, because the picker swaps between the empty and the
    // "file chosen" layouts — that swap is what these tests assert.
    const [proof, setProof] = useState<ProofFile | null>(null)
    return (
      <ProofPicker
        inputId="test-proof"
        proof={proof}
        onChange={(next) => {
          setProof(next)
          onChange?.(next)
        }}
      />
    )
  }

  function input(): HTMLInputElement {
    const element = document.querySelector<HTMLInputElement>('#test-proof')
    if (!element) throw new Error('proof input missing')
    return element
  }

  it('offers exactly the types and the size limit the backend accepts', () => {
    render(<Harness />)
    expect(input().getAttribute('accept')).toBe(
      'image/bmp,image/gif,image/jpeg,image/png,image/webp,application/pdf,.pdf',
    )
  })

  it('reports the real name, size and declared type of the chosen file', async () => {
    const changes: (ProofFile | null)[] = []
    render(<Harness onChange={(proof) => changes.push(proof)} />)

    const file = new File(['0123456789'], 'telebirr-receipt.png', {
      type: 'image/png',
    })
    await user.upload(input(), file)

    expect(await screen.findByText('telebirr-receipt.png')).toBeInTheDocument()
    expect(screen.getByText('10 B · image/png')).toBeInTheDocument()
    expect(changes.at(-1)).toMatchObject({
      fileName: 'telebirr-receipt.png',
      sizeBytes: 10,
      mimeType: 'image/png',
    })
  })

  it('refuses a type the backend would reject, and keeps no proof', async () => {
    // `applyAccept: false` reproduces what a drag-and-drop, or a user who picks
    // "All files" in the OS dialog, can actually hand the input — the accept
    // attribute is a filter hint, never a guarantee, so the component must
    // still reject the file itself.
    const unrestricted = userEvent.setup({ applyAccept: false })
    const changes: (ProofFile | null)[] = []
    render(<Harness onChange={(proof) => changes.push(proof)} />)

    await unrestricted.upload(input(), new File(['x'], 'notes.txt', { type: 'text/plain' }))

    expect(
      await screen.findByText('You can only attach an image or a PDF.'),
    ).toBeInTheDocument()
    expect(changes.at(-1)).toBeNull()
    expect(document.querySelector('.proof-preview')).toBeNull()
  })

  it('refuses a file over the 5 MB cap', async () => {
    const changes: (ProofFile | null)[] = []
    render(<Harness onChange={(proof) => changes.push(proof)} />)

    const oversized = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', {
      type: 'image/png',
    })
    await user.upload(input(), oversized)

    expect(
      await screen.findByText('The proof is too large. Max size is 5 MB.'),
    ).toBeInTheDocument()
    expect(changes.at(-1)).toBeNull()
  })

  it('keeps the input mounted so Replace can reopen the picker', async () => {
    render(<Harness />)
    await user.upload(input(), new File(['x'], 'proof.png', { type: 'image/png' }))
    await screen.findByText('proof.png')
    expect(input()).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replace' })).toBeEnabled()
  })

  it('shows an honest file chip, never a broken image, when object URLs are unavailable', async () => {
    // jsdom does not implement object URLs unless a test opts in; the picker
    // must degrade to the file's own metadata rather than render a dead <img>.
    render(<Harness />)
    await user.upload(input(), new File(['x'], 'receipt.pdf', { type: 'application/pdf' }))

    await screen.findByText('receipt.pdf')
    expect(document.querySelector('.proof-preview__img')).toBeNull()
    expect(screen.getByText('1 B · application/pdf')).toBeInTheDocument()
  })

  it('previews an actual image through an object URL of that very file', async () => {
    const url = globalThis.URL as unknown as Record<string, unknown>
    const originalCreate = url.createObjectURL
    const originalRevoke = url.revokeObjectURL
    const createObjectURL = vi.fn(() => 'blob:receipt')
    const revokeObjectURL = vi.fn()
    url.createObjectURL = createObjectURL
    url.revokeObjectURL = revokeObjectURL
    try {
      render(<Harness />)
      const file = new File(['x'], 'receipt.png', { type: 'image/png' })
      await user.upload(input(), file)

      await waitFor(() => {
        expect(document.querySelector('.proof-preview__img')).not.toBeNull()
      })
      expect(createObjectURL).toHaveBeenCalledWith(file)
      expect(
        document.querySelector<HTMLImageElement>('.proof-preview__img')?.getAttribute('src'),
      ).toBe('blob:receipt')

      // The URL is released when the chosen file goes away — otherwise every
      // replace would leak the previous receipt's bytes for the session.
      await user.click(screen.getByRole('button', { name: 'Remove' }))
      await waitFor(() => {
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:receipt')
      })
    } finally {
      url.createObjectURL = originalCreate
      url.revokeObjectURL = originalRevoke
    }
  })
})

describe('the customer stylesheet stays inside the customer scope', () => {
  it('namespaces every selector under .customer-shell', async () => {
    // `.customer-shell` is mounted only by `/p/:slug` and `/p/:slug/status`.
    // An unscoped selector here would silently restyle the Owner portal, the
    // Admin surface, the auth screens or the marketing site, which this redesign
    // must never touch.
    const css = await readFile(
      path.join(process.cwd(), 'src', 'styles', 'customer.css'),
      'utf8',
    )

    const offenders: string[] = []
    let depth = 0
    for (const rawLine of css.split('\n')) {
      const line = rawLine.trim()
      if (line === '' || line.startsWith('/*') || line.startsWith('*') || line.endsWith('*/')) {
        continue
      }
      if (line.startsWith('@')) {
        // A media/reduced-motion block only inherits the scope from its rules.
        if (!/^@(media|supports)/.test(line)) offenders.push(line)
        continue
      }
      if (line.startsWith('}')) {
        depth = Math.max(0, depth - 1)
        continue
      }
      if (line.includes('{')) {
        const selector = line.slice(0, line.indexOf('{')).trim()
        if (selector !== '' && !selector.startsWith('.customer-shell')) {
          offenders.push(selector)
        }
        depth += 1
      }
    }

    expect(offenders).toEqual([])
  })
})