import { apiRequest } from './http'
import type {
  OwnerScheduleConflictView,
  OwnerScheduleSaveResultView,
  OwnerScheduleView,
  PublicScheduleView,
  RecordExceptionPayload,
  SaveSchedulePayload,
  ScheduleExceptionView,
  UpdateBusinessSettingsInput,
  OwnerBusinessView,
} from './types'

/**
 * Owner schedule + public schedule API client (Prompt 47).
 *
 * Exactly the implemented backend routes are consumed (Prompt 42 §8): the
 * current/versions/conflicts reads, the versioned save, the Keep-Booking
 * exception, and the public schedule projection. Interval changes ride the
 * real business-settings endpoint (`PATCH …/settings`) because the backend
 * stores the booking interval on BusinessSettings, not on the schedule.
 *
 * Weekday conversion: the UI works in frontend days (Sunday = 0), the backend
 * in ISO weekdays (Monday = 1 … Sunday = 7). Mapping happens in
 * `schedule.mapper` — this client stays a thin wire layer.
 */

const OWNER_SCHEDULE = (businessId: string) => `/owner/businesses/${businessId}/schedule`

export function getOwnerSchedule(businessId: string): Promise<OwnerScheduleView> {
  return apiRequest<OwnerScheduleView>(`${OWNER_SCHEDULE(businessId)}/current`).then(
    ({ data }) => data,
  )
}

export function listOwnerScheduleVersions(
  businessId: string,
): Promise<OwnerScheduleView[]> {
  return apiRequest<OwnerScheduleView[]>(`${OWNER_SCHEDULE(businessId)}/versions`).then(
    ({ data }) => data,
  )
}

export function listOwnerScheduleConflicts(
  businessId: string,
): Promise<OwnerScheduleConflictView[]> {
  return apiRequest<OwnerScheduleConflictView[]>(
    `${OWNER_SCHEDULE(businessId)}/conflicts`,
  ).then(({ data }) => data)
}

export function saveOwnerSchedule(
  businessId: string,
  payload: SaveSchedulePayload,
): Promise<OwnerScheduleSaveResultView> {
  return apiRequest<OwnerScheduleSaveResultView>(OWNER_SCHEDULE(businessId), {
    method: 'PUT',
    body: payload,
  }).then(({ data }) => data)
}

export function recordScheduleException(
  businessId: string,
  payload: RecordExceptionPayload,
): Promise<ScheduleExceptionView> {
  return apiRequest<ScheduleExceptionView>(
    `${OWNER_SCHEDULE(businessId)}/exceptions`,
    {
      method: 'POST',
      body: payload,
    },
  ).then(({ data }) => data)
}

export function updateOwnerScheduleInterval(
  businessId: string,
  input: UpdateBusinessSettingsInput,
): Promise<OwnerBusinessView> {
  return apiRequest<OwnerBusinessView>(
    `/owner/businesses/${businessId}/settings`,
    { method: 'PATCH', body: input },
  ).then(({ data }) => data)
}

export function getPublicSchedule(slug: string): Promise<PublicScheduleView> {
  return apiRequest<PublicScheduleView>(`/public/businesses/${slug}/schedule`).then(
    ({ data }) => data,
  )
}