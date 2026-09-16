import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const CSS_FILE = path.join(process.cwd(), 'src', 'styles', 'components.css')

async function ruleFor(selector: string) {
  const css = await readFile(CSS_FILE, 'utf8')
  const match = css.match(
    new RegExp(`(?:^|\\n)\\s*${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`),
  )
  if (!match) throw new Error(`rule for "${selector}" not found`)
  return match[1]
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

describe('public booking layout overflow guards', () => {
  it('lets the wizard content column shrink below its content width', async () => {
    // A grid track is "1fr" (minmax(auto, 1fr)); without an explicit minimum
    // the track will not shrink below the widest child's min-content. On the
    // Date & time step the horizontally scrollable date strip's full chip row
    // becomes that min-content and pushes the whole layout past the viewport.
    expect(await ruleFor('.wizard__main')).toMatch(/min-width:\s*0/)
  })

  it('keeps the stepper screen-reader labels clipped to its scroll area', async () => {
    // The stepper's sr-only spans are absolutely positioned; without a
    // positioned ancestor inside the scroll container they resolve their
    // containing block to the page and widen the document past the viewport
    // whenever the stepper scrolls horizontally on small screens.
    expect(await ruleFor('.stepper__step')).toMatch(/position:\s*relative/)
  })

  it('keeps the date strip a self-contained horizontal scroll area', async () => {
    const dateStrip = await ruleFor('.date-strip')
    expect(dateStrip).toMatch(/overflow-x:\s*auto/)
  })

  it('lets the status lookup card shrink below its content width', async () => {
    // The customer status card is a flex column inside the results flex column;
    // without an explicit min-width the card cannot shrink below the widest
    // line item on narrow screens and would push the page past the viewport.
    expect(await ruleFor('.status-card')).toMatch(/min-width:\s*0/)
  })

  it('wraps long content inside status cards instead of overflowing', async () => {
    const card = await ruleFor('.status-card')
    expect(card).toMatch(/overflow-wrap:\s*anywhere/)
  })

  it('fits the phone lookup form to the content column on mobile', async () => {
    // The form is constrained to the content width and its input is already
    // width-aware; this guard keeps the form card from expanding the viewport.
    expect(await ruleFor('.status-page__form')).toMatch(/max-width:\s*var\(--content-max\)/)
  })

  it('keeps the Telegram panel shrinkable with long content wrapping on narrow screens', async () => {
    // The panel is a flex column inside the results column; like the status
    // card it must be able to shrink below its content width, and long
    // rejection-reason text must wrap instead of overflowing the viewport.
    const panel = await ruleFor('.telegram-panel')
    expect(panel).toMatch(/min-width:\s*0/)
    expect(panel).toMatch(/overflow-wrap:\s*anywhere/)
  })

  it('wraps long owner-authored description text inside the public hero', async () => {
    // A very long one-line description must wrap on narrow screens instead of
    // widening the page.
    const desc = await ruleFor('.hero__desc')
    expect(desc).toMatch(/overflow-wrap:\s*anywhere/)
  })

  it('fits a long public booking link into the preview row', async () => {
    // The link is shown in the owner preview with a mono font; a long slug
    // must break rather than overflow the card.
    const link = await ruleFor('.public-url-card__link')
    expect(link).toMatch(/word-break:\s*break-all/)
  })
})

describe('bookings workspace layout overflow guards', () => {
  it('wraps the filter/sort toolbar instead of overflowing', async () => {
    // The toolbar is a flex row holding date inputs, search and the sort
    // control; without wrapping it would push past the viewport on mobile.
    expect(await ruleFor('.booking-toolbar')).toMatch(/flex-wrap:\s*wrap/)
  })

  it('lets search and date fields shrink below their content width', async () => {
    // Each toolbar control is a flex column inside the wrapping toolbar;
    // without an explicit min-width the inputs cannot shrink below their
    // intrinsic width on narrow screens.
    const css = await readFile(CSS_FILE, 'utf8')
    const field = css.match(
      /\.booking-field,\s*\.booking-search\s*\{([^}]*)\}/,
    )
    expect(field).not.toBeNull()
    expect(field![1]).toMatch(/min-width:\s*0/)
  })

  it('signals a selected status pill with a filled dot, not colour alone', async () => {
    // Software engineers must be able to tell selected from unselected pills
    // without relying on hue; the pressed pseudo-element draws a filled dot.
    const base = await ruleFor('.booking-pill::before')
    expect(base).toMatch(/border-radius:\s*50%/)
    const pressed = await ruleFor('.booking-pill[aria-pressed="true"]::before')
    expect(pressed).toMatch(/background:\s*var\(--accent-strong\)/)
  })

  it('wraps over-long customer names inside booking cards', async () => {
    // A very long customer name or phone must wrap inside the card rather
    // than widen the page on narrow viewports.
    expect(await ruleFor('.booking-card__name')).toMatch(/overflow-wrap:\s*anywhere/)
  })

  it('lets booking cards shrink below their content width', async () => {
    expect(await ruleFor('.booking-card')).toMatch(/min-width:\s*0/)
  })

  it('wraps label/value rows on the booking detail page', async () => {
    const row = await ruleFor('.booking-detail__row')
    expect(row).toMatch(/flex-wrap:\s*wrap/)
    expect(row).toMatch(/overflow-wrap:\s*anywhere/)
  })

  it('signals the Telegram connection with a shape, not colour alone', async () => {
    expect(await ruleFor('.telegram-state::before')).toMatch(/border-radius:\s*50%/)
  })

  it('centers the empty-state prompt without stretching the page', async () => {
    const empty = await ruleFor('.booking-empty')
    expect(empty).toMatch(/align-items:\s*center/)
    expect(empty).toMatch(/flex-direction:\s*column/)
  })

  it('stacks toolbar controls full-width inside the narrow-screen media query', async () => {
    const css = await readFile(CSS_FILE, 'utf8')
    const lastMobile = css.lastIndexOf('@media (max-width: 640px)')
    expect(lastMobile).toBeGreaterThan(-1)
    const block = css.slice(lastMobile)
    expect(block).toMatch(/\.booking-field/)
    expect(block).toMatch(/flex: 1 1 100%;/)
  })
})