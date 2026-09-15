import type { ScheduleVersion } from '@/types/models'
import { describeScheduleChange } from '@/lib/scheduleHistory'
import { formatTimestamp } from '@/lib/time'

const STATUS_LABEL: Record<ScheduleVersion['status'], string> = {
  active: 'Active',
  pending: 'Pending',
  superseded: 'Superseded',
}

const STATUS_CHIP: Record<ScheduleVersion['status'], string> = {
  active: 'version-chip--active',
  pending: 'version-chip--pending',
  superseded: 'version-chip--superseded',
}

/**
 * View-only schedule history (REQ-166/169): retained schedule versions with
 * who, when, what changed and the reason. No restore/revert action exists.
 */
export function ScheduleHistory({ versions }: { versions: readonly ScheduleVersion[] }) {
  return (
    <section
      className="card card--padded"
      aria-labelledby="schedule-history-title"
    >
      <h2 className="card__title" id="schedule-history-title">
        Schedule history
      </h2>
      <p className="card__subtitle">
        Every saved schedule state is kept as a version. This view is read-only.
      </p>

      {versions.length === 0 ? (
        <p className="subsection__empty">
          No schedule versions yet. Save the schedule to record the first one.
        </p>
      ) : (
        <ol className="history-list">
          {versions.map((version, index) => {
            const previous = index + 1 < versions.length ? versions[index + 1].snapshot : null
            return (
              <li key={version.id} className="history-row">
                <span className="history-row__meta">
                  <span className={`version-chip ${STATUS_CHIP[version.status]}`}>
                    {STATUS_LABEL[version.status]}
                  </span>
                  <strong>
                    {version.automatic ? 'System (automatic)' : version.actor}
                  </strong>
                  <span className="booking-card__meta">{formatTimestamp(version.at)}</span>
                </span>
                <span className="history-row__change">
                  {describeScheduleChange(previous, version.snapshot)}
                </span>
                {version.reason && (
                  <span className="history-row__reason">
                    Reason: &ldquo;{version.reason}&rdquo;
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}