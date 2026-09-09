import { api } from './api';

/**
 * Scheduling management API client (Prompt 12 — Domains 12/13/16).
 *
 * All owner routes live under /api/v1/businesses/:businessId/schedule. Time
 * entries follow the platform convention: working periods and special-date
 * periods are minutes-since-local-midnight, dates are 'YYYY-MM-DD' local
 * calendar days, and blocked-period instants are ISO date-times (doc 10 §2).
 */
export interface WorkingPeriodInput {
  dayOfWeek: number; // 0 = Sunday
  startMinutes: number;
  endMinutes: number;
}

export interface SpecialDatePeriodInput {
  startMinutes: number;
  endMinutes: number;
}

export interface SpecialDateInput {
  date: string; // 'YYYY-MM-DD' local calendar day
  isClosed: boolean;
  periods: SpecialDatePeriodInput[];
}

export interface BlockedPeriodInput {
  startAt: string;
  endAt: string;
  reason?: string;
}

export interface ScheduleInput {
  bookingIntervalMinutes: number;
  reason?: string;
  workingPeriods: WorkingPeriodInput[];
  specialDates: SpecialDateInput[];
  blockedPeriods: BlockedPeriodInput[];
}

export interface KeepBookingInput {
  reason?: string;
}

export interface WorkingPeriodDto {
  dayOfWeek: number;
  startMinutes: number;
  endMinutes: number;
}

export interface SpecialDateDto {
  id: string;
  calendarDate: string;
  isClosed: boolean;
  periods: { startMinutes: number; endMinutes: number }[];
}

export interface BlockedPeriodDto {
  id: string;
  startAt: string;
  endAt: string;
  reason: string | null;
}

export interface ScheduleVersionDto {
  id: string;
  status: string; // ACTIVE | PENDING | SUPERSEDED
  actorType: string;
  actorUserId: string | null;
  reason: string | null;
  bookingIntervalMinutes: number;
  createdAt: string;
  updatedAt: string;
  workingPeriods: WorkingPeriodDto[];
  specialDates: SpecialDateDto[];
  blockedPeriods: BlockedPeriodDto[];
}

export interface ServiceSnapshotDto {
  name: string;
  durationMinutes: number;
}

export const REASON_LABELS: Record<string, string> = {
  WEEKLY_HOURS: 'Outside weekly working hours',
  SPECIAL_DATE_CLOSED: 'Closed on a special date',
  SPECIAL_DATE_HOURS: 'Outside special-date hours',
  BLOCKED_PERIOD: 'Inside a blocked period',
};

export interface AffectedBookingDto {
  bookingId: string;
  customerName: string;
  customerPhone: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  services: ServiceSnapshotDto[];
  reason: string;
  kept: boolean;
}

export const WEEKDAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/** 0..1439 minutes → 'HH:MM' in the global Africa/Addis_Ababa wall clock. */
export function minutesToClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 'HH:MM' → minutes since local midnight; null when malformed/out of range. */
export function clockToMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

export function statusPillClass(status: string): string {
  switch (status) {
    case 'ACTIVE':
      return 'pill info';
    case 'PENDING':
      return 'pill warn';
    default:
      return 'pill';
  }
}

export interface ScheduleCurrentDto {
  version: ScheduleVersionDto | null;
  isPaused: boolean;
  warnings: AffectedBookingDto[];
  kept: AffectedBookingDto[];
}

export interface ScheduleHistoryDto {
  total: number;
  versions: ScheduleVersionDto[];
}

export interface KeepBookingResultDto {
  ok: true;
  bookingId: string;
  exception: { id: string; scheduleVersionId: string; reason: string | null; createdAt: string };
}

export interface SchedulePageParams {
  page?: number;
  pageSize?: number;
  from?: string;
  to?: string;
}

export const scheduleApi = {
  current: (businessId: string) =>
    api.get<ScheduleCurrentDto>(`/api/v1/businesses/${businessId}/schedule`),
  save: (businessId: string, input: ScheduleInput) =>
    api.put<ScheduleCurrentDto>(`/api/v1/businesses/${businessId}/schedule`, input),
  keepBooking: (businessId: string, bookingId: string, input: KeepBookingInput) =>
    api.post<KeepBookingResultDto>(
      `/api/v1/businesses/${businessId}/schedule/bookings/${bookingId}/keep`,
      input,
    ),
  history: (businessId: string, params: SchedulePageParams) => {
    const q = new URLSearchParams();
    if (params.page !== undefined) q.set('page', String(params.page));
    if (params.pageSize !== undefined) q.set('pageSize', String(params.pageSize));
    if (params.from) q.set('from', params.from);
    if (params.to) q.set('to', params.to);
    const qs = q.toString();
    return api.get<ScheduleHistoryDto>(
      `/api/v1/businesses/${businessId}/schedule/history${qs ? `?${qs}` : ''}`,
    );
  },
  historyPdfUrl: (businessId: string): string =>
    `/api/v1/businesses/${businessId}/schedule/history/pdf`,
};
