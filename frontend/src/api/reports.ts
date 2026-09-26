import { apiDownload, apiRequest } from './http'
import type { BookingHistoryReportView } from './types'

/**
 * Reporting client (Prompt 59; REQ-177 … REQ-190, REQ-170).
 *
 * Consumes exactly the implemented backend routes under `/api/v1`:
 *  - `GET /admin/reports/booking-history`            (Super Admin, REQ-177)
 *  - `GET /admin/reports/booking-history.pdf`        (Super Admin, REQ-178)
 *  - `GET /admin/businesses/:id/schedule-history.pdf`(Super Admin, REQ-170)
 *  - `GET /owner/businesses/:id/schedule-history.pdf`(Owner own business, REQ-170)
 *
 * Authorization is server-side (session cookie); the client never supplies a
 * role or actor id. No owner booking-report PDF exists — that decision remains
 * unresolved (§46 item 4) and is deliberately absent.
 */

export interface BookingHistoryQuery {
  /** OR within the category (REQ-185). */
  status?: string[]
  actorType?: string[]
  actorUserId?: string
  /** One business, or omitted for all businesses (REQ-180/181). */
  businessId?: string
  from?: string
  to?: string
  sortBy?: string
  sortDirection?: 'asc' | 'desc'
  offset?: number
  limit?: number
}

export interface ReportDownload {
  blob: Blob
  fileName: string | null
  contentType: string | null
}

function toQuery(query: BookingHistoryQuery): Record<string, string | number | undefined> {
  return {
    status: query.status && query.status.length > 0 ? query.status.join(',') : undefined,
    actorType: query.actorType && query.actorType.length > 0 ? query.actorType.join(',') : undefined,
    actorUserId: query.actorUserId || undefined,
    businessId: query.businessId || undefined,
    from: query.from || undefined,
    to: query.to || undefined,
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
    offset: query.offset,
    limit: query.limit,
  }
}

/** Super Admin booking status-history report (REQ-177). */
export function listBookingHistory(
  query: BookingHistoryQuery = {},
  signal?: AbortSignal,
): Promise<BookingHistoryReportView> {
  return apiRequest<BookingHistoryReportView>('/admin/reports/booking-history', {
    method: 'GET',
    query: toQuery(query),
    signal,
  }).then(({ data }) => data)
}

/** Super Admin booking status-history PDF export (REQ-178..183). */
export function downloadBookingHistoryPdf(
  query: BookingHistoryQuery = {},
  signal?: AbortSignal,
): Promise<ReportDownload> {
  return apiDownload('/admin/reports/booking-history.pdf', { method: 'GET', query: toQuery(query), signal }).then(
    ({ data, fileName, contentType }) => ({ blob: data, fileName, contentType }),
  )
}

/** Schedule-history PDF: Super Admin (any business) or Owner (own business). */
export function downloadScheduleHistoryPdf(
  businessId: string,
  scope: 'admin' | 'owner',
  range: { from?: string; to?: string } = {},
  signal?: AbortSignal,
): Promise<ReportDownload> {
  const base = scope === 'admin' ? '/admin' : '/owner'
  const path = `${base}/businesses/${encodeURIComponent(businessId)}/schedule-history.pdf`
  return apiDownload(path, {
    method: 'GET',
    query: { from: range.from || undefined, to: range.to || undefined },
    signal,
  }).then(({ data, fileName, contentType }) => ({ blob: data, fileName, contentType }))
}
