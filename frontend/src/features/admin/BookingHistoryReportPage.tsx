import { useCallback, useEffect, useState } from 'react'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { toUserMessage } from '@/api/errors'
import { downloadBookingHistoryPdf, listBookingHistory, type BookingHistoryQuery } from '@/api/reports'
import { saveBlob } from '@/lib/download'
import type { BookingHistoryReportView, BookingHistoryRowView } from '@/api/types'

const STATUSES = ['PAYMENT_PENDING', 'CONFIRMED', 'REJECTED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] as const
const ACTOR_TYPES = ['SYSTEM', 'CUSTOMER', 'OWNER', 'ADMIN', 'SUPER_ADMIN'] as const
const SORT_KEYS = ['date', 'bookingId', 'customer', 'business', 'status', 'actor'] as const

interface Filters {
  status: string[]
  actorType: string[]
  businessId: string
  from: string
  to: string
  sortBy: string
  sortDirection: 'asc' | 'desc'
}

const EMPTY_FILTERS: Filters = {
  status: [],
  actorType: [],
  businessId: '',
  from: '',
  to: '',
  sortBy: 'date',
  sortDirection: 'desc',
}

function toQuery(filters: Filters): BookingHistoryQuery {
  return {
    status: filters.status,
    actorType: filters.actorType,
    businessId: filters.businessId.trim() || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    sortBy: filters.sortBy,
    sortDirection: filters.sortDirection,
    limit: 200,
  }
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

function CheckboxGroup({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string
  options: readonly string[]
  selected: string[]
  onToggle: (value: string) => void
}) {
  return (
    <fieldset className="report-filter__group">
      <legend className="field__label">{label}</legend>
      <div className="report-filter__options">
        {options.map((option) => (
          <label key={option} className="report-filter__option">
            <input type="checkbox" checked={selected.includes(option)} onChange={() => onToggle(option)} />
            <span>{option}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/**
 * Super Admin booking status-history report (REQ-177/178/184…190).
 *
 * Real backend data (`GET /admin/reports/booking-history`); real PDF export of
 * the current filters (`GET /admin/reports/booking-history.pdf`). Filters are
 * stateless — Reset returns to the server-side most-recent-30-days window
 * (REQ-186). Admins never reach this page (route guard + backend 403).
 */
export function BookingHistoryReportPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [report, setReport] = useState<BookingHistoryReportView | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const load = useCallback(async (current: Filters) => {
    setLoading(true)
    setLoadError(null)
    try {
      setReport(await listBookingHistory(toQuery(current)))
    } catch (error) {
      setLoadError(toUserMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(filters)
  }, [filters, load])

  const update = (patch: Partial<Filters>) => setFilters((prev) => ({ ...prev, ...patch }))

  async function handleExport() {
    setExporting(true)
    setExportError(null)
    try {
      const { blob, fileName } = await downloadBookingHistoryPdf(toQuery(filters))
      saveBlob(blob, fileName ?? 'booking-history.pdf')
    } catch (error) {
      setExportError(toUserMessage(error))
    } finally {
      setExporting(false)
    }
  }

  const rows: BookingHistoryRowView[] = report?.rows ?? []

  return (
    <div className="admin-report">
      <h1 className="page-title">Booking history report</h1>
      <p className="page-subtitle">
        Full booking status history across all businesses, or one business (REQ-177/178).
      </p>

      {loadError && (
        <Alert tone="danger" title="Could not load the report">
          {loadError}
        </Alert>
      )}
      {exportError && (
        <Alert tone="danger" title="The export did not go through">
          {exportError}
        </Alert>
      )}

      <section className="card card--padded report-filter" aria-label="Report filters">
        <CheckboxGroup
          label="Status"
          options={STATUSES}
          selected={filters.status}
          onToggle={(value) => update({ status: toggle(filters.status, value) })}
        />
        <CheckboxGroup
          label="Actor"
          options={ACTOR_TYPES}
          selected={filters.actorType}
          onToggle={(value) => update({ actorType: toggle(filters.actorType, value) })}
        />

        <div className="report-filter__group">
          <Field label="Business (UUID, optional)">
            {({ id }) => (
              <input
                id={id}
                className="input"
                type="text"
                placeholder="Single business UUID or empty for all"
                value={filters.businessId}
                onChange={(event) => update({ businessId: event.target.value })}
              />
            )}
          </Field>
        </div>

        <div className="report-filter__group report-filter__dates">
          <Field label="From">
            {({ id }) => (
              <input
                id={id}
                className="input"
                type="date"
                value={filters.from}
                onChange={(event) => update({ from: event.target.value })}
              />
            )}
          </Field>
          <Field label="To">
            {({ id }) => (
              <input
                id={id}
                className="input"
                type="date"
                value={filters.to}
                onChange={(event) => update({ to: event.target.value })}
              />
            )}
          </Field>
        </div>

        <div className="report-filter__group report-filter__dates">
          <Field label="Sort by">
            {({ id }) => (
              <select
                id={id}
                className="input"
                value={filters.sortBy}
                onChange={(event) => update({ sortBy: event.target.value })}
              >
                {SORT_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Direction">
            {({ id }) => (
              <select
                id={id}
                className="input"
                value={filters.sortDirection}
                onChange={(event) => update({ sortDirection: event.target.value as 'asc' | 'desc' })}
              >
                <option value="desc">Newest first</option>
                <option value="asc">Oldest first</option>
              </select>
            )}
          </Field>
        </div>

        <div className="proof-queue__actions">
          <Button type="button" variant="outline" onClick={() => setFilters(EMPTY_FILTERS)}>
            Reset to last 30 days
          </Button>
          <Button type="button" loading={exporting} disabled={exporting} onClick={() => void handleExport()}>
            Export PDF
          </Button>
        </div>
      </section>

      {loading ? (
        <p className="telegram-panel__note">Loading report…</p>
      ) : rows.length === 0 ? (
        <p className="telegram-panel__note">No history rows match these filters.</p>
      ) : (
        <div className="report-table-wrapper">
          <table className="report-table">
            <caption className="field__hint">
              {report?.total ?? rows.length} row(s) · window {formatDay(report?.from)} to {formatDay(report?.to)}
            </caption>
            <thead>
              <tr>
                <th scope="col">Date &amp; time</th>
                <th scope="col">Booking ID</th>
                <th scope="col">Customer</th>
                <th scope="col">Business</th>
                <th scope="col">Status change</th>
                <th scope="col">Actor</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.bookingId}-${row.occurredAt}-${index}`}>
                  <td>{new Date(row.occurredAt).toISOString().slice(0, 16).replace('T', ' ')}</td>
                  <td>{row.bookingId}</td>
                  <td>{row.customerName}</td>
                  <td>{row.businessName}</td>
                  <td>
                    {row.fromStatus ?? '—'} &rarr; {row.toStatus}
                  </td>
                  <td>{row.actorType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function formatDay(value: string | undefined): string {
  return value ? value.slice(0, 10) : '—'
}
