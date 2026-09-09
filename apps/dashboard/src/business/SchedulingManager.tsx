import { useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import {
  clockToMinutes,
  minutesToClock,
  REASON_LABELS,
  statusPillClass,
  WEEKDAY_LABELS,
  scheduleApi,
  type AffectedBookingDto,
  type ScheduleCurrentDto,
  type ScheduleInput,
  type ScheduleVersionDto,
} from '../lib/schedule-api';

function message(err: unknown): string {
  if (err instanceof ApiError) {
    return err.fields && err.fields.length > 0
      ? `${err.message}: ${err.fields.map((f) => f.message).join('; ')}`
      : err.message;
  }
  return err instanceof Error ? err.message : 'Request failed.';
}

function fmtInstant(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface WeeklyRow {
  dayOfWeek: number;
  open: string;
  close: string;
}

interface SpecialRow {
  date: string;
  isClosed: boolean;
  open: string;
  close: string;
}

interface BlockedRow {
  startAt: string;
  endAt: string;
  reason: string;
}

const INTERVALS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];

export function SchedulingManager({ businessId, back }: { businessId: string; back: () => void }) {
  const [current, setCurrent] = useState<ScheduleCurrentDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const reload = async () => {
    try {
      setCurrent(await scheduleApi.current(businessId));
    } catch (err) {
      setError(message(err));
    }
  };

  useEffect(() => {
    void reload();
  }, [businessId]);

  if (error) return <p className="alert">{error}</p>;
  if (!current) return <p className="muted">Loading schedule…</p>;

  return (
    <section>
      <div className="row">
        <h2>Schedule</h2>
        <span className="pill">{current.version ? current.version.status : 'none'}</span>
        {current.isPaused ? <span className="pill warn">business paused</span> : null}
      </div>

      {current.isPaused ? (
        <p className="alert">
          This business is paused. Schedules saved now are stored as PENDING and activate
          automatically when you resume.
        </p>
      ) : null}

      <div className="row">
        <button type="button" className="secondary" onClick={() => setEditing((v) => !v)}>
          {editing ? 'Close editor' : current.version ? 'Edit schedule' : 'Create schedule'}
        </button>
        <button type="button" className="secondary" onClick={() => setShowHistory((v) => !v)}>
          {showHistory ? 'Hide history' : 'Version history'}
        </button>
        <a
          className="button-link"
          href={scheduleApi.historyPdfUrl(businessId)}
          target="_blank"
          rel="noreferrer"
        >
          Export PDF
        </a>
        <button type="button" className="secondary" onClick={() => back()}>
          Back
        </button>
      </div>

      {editing ? (
        <ScheduleEditor
          businessId={businessId}
          current={current}
          onSaved={(next) => {
            setCurrent(next);
            setEditing(false);
          }}
          onCancelled={() => setEditing(false)}
        />
      ) : null}

      <AffectedPanel current={current} businessId={businessId} onChanged={() => void reload()} />

      {showHistory ? <HistoryPanel businessId={businessId} /> : null}

      <ScheduleSummary version={current.version} />
    </section>
  );
}

function ScheduleEditor({
  businessId,
  current,
  onSaved,
  onCancelled,
}: {
  businessId: string;
  current: ScheduleCurrentDto;
  onSaved: (next: ScheduleCurrentDto) => void;
  onCancelled: () => void;
}) {
  const version = current.version;
  const [interval, setIntervalValue] = useState(String(version?.bookingIntervalMinutes ?? 30));
  const [reason, setReason] = useState('');
  const [weekly, setWeekly] = useState<WeeklyRow[]>(() =>
    WEEKDAY_LABELS.map((_, day) => {
      const windows = (version?.workingPeriods ?? []).filter((w) => w.dayOfWeek === day);
      const first = windows[0];
      return {
        dayOfWeek: day,
        open: first ? minutesToClock(first.startMinutes) : '',
        close: first ? minutesToClock(first.endMinutes) : '',
      };
    }),
  );
  const [specials, setSpecials] = useState<SpecialRow[]>(() =>
    (version?.specialDates ?? []).map((s) => {
      const first = s.periods[0];
      return {
        date: s.calendarDate,
        isClosed: s.isClosed,
        open: first ? minutesToClock(first.startMinutes) : '',
        close: first ? minutesToClock(first.endMinutes) : '',
      };
    }),
  );
  const [blocked, setBlocked] = useState<BlockedRow[]>(() =>
    (version?.blockedPeriods ?? []).map((b) => ({
      startAt: toLocalInput(b.startAt),
      endAt: toLocalInput(b.endAt),
      reason: b.reason ?? '',
    })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setWeeklyRow = (day: number, patch: Partial<WeeklyRow>) =>
    setWeekly((rows) => rows.map((r) => (r.dayOfWeek === day ? { ...r, ...patch } : r)));

  function buildInput(): ScheduleInput | null {
    const workingPeriods: ScheduleInput['workingPeriods'] = [];
    for (const row of weekly) {
      const open = clockToMinutes(row.open);
      const close = clockToMinutes(row.close);
      if (!row.open.trim() && !row.close.trim()) continue;
      if (open === null || close === null) {
        setError(`${WEEKDAY_LABELS[row.dayOfWeek]}: enter whole HH:MM times.`);
        return null;
      }
      if (close <= open) {
        setError(`${WEEKDAY_LABELS[row.dayOfWeek]}: closing time must be after opening time.`);
        return null;
      }
      workingPeriods.push({ dayOfWeek: row.dayOfWeek, startMinutes: open, endMinutes: close });
    }

    const specialDates: ScheduleInput['specialDates'] = [];
    for (const row of specials) {
      if (!row.date.trim()) continue;
      if (!row.isClosed) {
        const open = clockToMinutes(row.open);
        const close = clockToMinutes(row.close);
        if (!row.open.trim() && !row.close.trim()) {
          specialDates.push({ date: row.date, isClosed: true, periods: [] });
          continue;
        }
        if (open === null || close === null || close <= open) {
          setError(`${row.date}: enter valid opening hours or mark it closed.`);
          return null;
        }
        specialDates.push({
          date: row.date,
          isClosed: false,
          periods: [{ startMinutes: open, endMinutes: close }],
        });
      } else {
        specialDates.push({ date: row.date, isClosed: true, periods: [] });
      }
    }

    const blockedPeriods: ScheduleInput['blockedPeriods'] = [];
    for (const row of blocked) {
      if (!row.startAt.trim() && !row.endAt.trim()) continue;
      const start = new Date(row.startAt);
      const end = new Date(row.endAt);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
        setError('Blocked periods need a valid start before their end.');
        return null;
      }
      blockedPeriods.push({
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        reason: row.reason.trim() ? row.reason.trim().slice(0, 200) : undefined,
      });
    }

    const intervalMinutes = Number(interval);
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < 5 || intervalMinutes > 240) {
      setError('Booking interval must be a whole number of minutes (5–240).');
      return null;
    }

    const cleanReason = reason.trim() ? reason.trim().slice(0, 500) : undefined;
    if (workingPeriods.length === 0 && specialDates.length === 0 && blockedPeriods.length === 0) {
      setError(
        'Every day is closed — bookings would be blocked entirely. Set at least one window.',
      );
      return null;
    }
    return {
      bookingIntervalMinutes: intervalMinutes,
      ...(cleanReason ? { reason: cleanReason } : {}),
      workingPeriods,
      specialDates,
      blockedPeriods,
    };
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = buildInput();
    if (!input) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await scheduleApi.save(businessId, input));
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="schedule-editor">
      {current.isPaused ? (
        <p className="muted">Saving creates a PENDING version — it activates on resume.</p>
      ) : (
        <p className="muted">
          Saving replaces the current ACTIVE version. Bookings that no longer fit are listed below
          so you can reschedule or keep them.
        </p>
      )}

      <div className="row field-grid">
        <label>
          Booking interval (minutes)
          <select value={interval} onChange={(e) => setIntervalValue(e.target.value)}>
            {INTERVALS.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </label>
        <label className="span-2">
          Reason for this change (optional)
          <input
            value={reason}
            maxLength={500}
            placeholder="e.g. new working hours starting next week"
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      </div>

      <h3>Weekly working hours</h3>
      <table className="data-table schedule-hours">
        <thead>
          <tr>
            <th>Day</th>
            <th>Opens</th>
            <th>Closes</th>
          </tr>
        </thead>
        <tbody>
          {weekly.map((row) => (
            <tr key={row.dayOfWeek}>
              <td>{WEEKDAY_LABELS[row.dayOfWeek]}</td>
              <td>
                <input
                  type="time"
                  value={row.open}
                  onChange={(e) => setWeeklyRow(row.dayOfWeek, { open: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="time"
                  value={row.close}
                  onChange={(e) => setWeeklyRow(row.dayOfWeek, { close: e.target.value })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Special dates &amp; blocked periods</h3>
      <ScheduleEditorSub
        specials={specials}
        setSpecials={setSpecials}
        blocked={blocked}
        setBlocked={setBlocked}
      />

      <div className="row">
        <button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save schedule'}
        </button>
        <button type="button" className="secondary" onClick={onCancelled} disabled={busy}>
          Cancel
        </button>
      </div>
      {error ? <p className="alert">{error}</p> : null}
    </form>
  );
}

function ScheduleEditorSub({
  specials,
  setSpecials,
  blocked,
  setBlocked,
}: {
  specials: SpecialRow[];
  setSpecials: React.Dispatch<React.SetStateAction<SpecialRow[]>>;
  blocked: BlockedRow[];
  setBlocked: React.Dispatch<React.SetStateAction<BlockedRow[]>>;
}) {
  const setSpecial = (idx: number, patch: Partial<SpecialRow>) =>
    setSpecials((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const setBlockedRow = (idx: number, patch: Partial<BlockedRow>) =>
    setBlocked((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  return (
    <div className="schedule-sublists">
      <div>
        {specials.map((row, idx) => (
          <div className="row schedule-row" key={idx}>
            <input
              type="date"
              value={row.date}
              onChange={(e) => setSpecial(idx, { date: e.target.value })}
            />
            <label className="schedule-closed">
              <input
                type="checkbox"
                checked={row.isClosed}
                onChange={(e) => setSpecial(idx, { isClosed: e.target.checked })}
              />
              Closed
            </label>
            {!row.isClosed ? (
              <>
                <input
                  type="time"
                  value={row.open}
                  aria-label="Opens"
                  onChange={(e) => setSpecial(idx, { open: e.target.value })}
                />
                <input
                  type="time"
                  value={row.close}
                  aria-label="Closes"
                  onChange={(e) => setSpecial(idx, { close: e.target.value })}
                />
              </>
            ) : null}
            <button
              type="button"
              className="danger-button"
              onClick={() => setSpecials((rows) => rows.filter((_, i) => i !== idx))}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="secondary"
          onClick={() =>
            setSpecials((rows) => [
              ...rows,
              { date: '', isClosed: false, open: '09:00', close: '17:00' },
            ])
          }
        >
          Add special date
        </button>
      </div>

      <div>
        {blocked.map((row, idx) => (
          <div className="row schedule-row" key={idx}>
            <input
              type="datetime-local"
              aria-label="Blocked from"
              value={row.startAt}
              onChange={(e) => setBlockedRow(idx, { startAt: e.target.value })}
            />
            <input
              type="datetime-local"
              aria-label="Blocked until"
              value={row.endAt}
              onChange={(e) => setBlockedRow(idx, { endAt: e.target.value })}
            />
            <input
              defaultValue={row.reason}
              placeholder="reason (optional)"
              onChange={(e) => setBlockedRow(idx, { reason: e.target.value })}
            />
            <button
              type="button"
              className="danger-button"
              onClick={() => setBlocked((rows) => rows.filter((_, i) => i !== idx))}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="secondary"
          onClick={() => setBlocked((rows) => [...rows, { startAt: '', endAt: '', reason: '' }])}
        >
          Add blocked period
        </button>
      </div>
    </div>
  );
}

function AffectedPanel({
  current,
  businessId,
  onChanged,
}: {
  current: ScheduleCurrentDto;
  businessId: string;
  onChanged: () => void;
}) {
  const [keepingId, setKeepingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (current.warnings.length === 0 && current.kept.length === 0) return null;

  async function keep(booking: AffectedBookingDto) {
    const inputRaw = window.prompt(
      'Optional reason for keeping this booking under the changed schedule.',
    );
    if (inputRaw === null) return;
    setKeepingId(booking.bookingId);
    setError(null);
    try {
      await scheduleApi.keepBooking(businessId, booking.bookingId, {
        reason: inputRaw.trim() ? inputRaw.trim().slice(0, 500) : undefined,
      });
      onChanged();
    } catch (err) {
      setError(message(err));
    } finally {
      setKeepingId(null);
    }
  }

  return (
    <div className="schedule-affected">
      {error ? <p className="alert">{error}</p> : null}
      {current.warnings.length > 0 ? (
        <>
          <h3>Affected bookings ({current.warnings.length})</h3>
          <p className="muted">
            These bookings no longer fit the schedule. Reschedule them in Manage bookings, or keep
            them below to leave them unchanged.
          </p>
          {current.warnings.map((b) => (
            <div className="row schedule-row" key={b.bookingId}>
              <span>
                <strong>{b.customerName}</strong> {fmtInstant(b.startAt)}–{fmtInstant(b.endAt)}
              </span>
              <span className="pill warn">{REASON_LABELS[b.reason] ?? b.reason}</span>
              <button
                type="button"
                className="secondary"
                disabled={keepingId !== null}
                onClick={() => void keep(b)}
              >
                {keepingId === b.bookingId ? 'Saving…' : 'Keep booking'}
              </button>
            </div>
          ))}
        </>
      ) : null}
      {current.kept.length > 0 ? (
        <>
          <h3>Kept bookings ({current.kept.length})</h3>
          {current.kept.map((b) => (
            <div className="row schedule-row" key={b.bookingId}>
              <span>
                <strong>{b.customerName}</strong> {fmtInstant(b.startAt)}
              </span>
              <span className="pill info">kept</span>
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}

function HistoryPanel({ businessId }: { businessId: string }) {
  const [versions, setVersions] = useState<ScheduleVersionDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 20;

  useEffect(() => {
    let active = true;
    scheduleApi
      .history(businessId, { page, pageSize })
      .then((r) => {
        if (!active) return;
        setVersions(r.versions);
        setTotal(r.total);
      })
      .catch((err) => active && setError(message(err)));
    return () => {
      active = false;
    };
  }, [businessId, page]);

  const pages = Math.ceil(total / pageSize);

  return (
    <div className="schedule-history">
      <h3>Version history ({total} total)</h3>
      {error ? <p className="alert">{error}</p> : null}
      {versions === null ? (
        <p className="muted">Loading history…</p>
      ) : versions.length === 0 ? (
        <p className="muted">No schedule versions saved yet.</p>
      ) : (
        <>
          {versions.map((v) => (
            <div className="schedule-history-row" key={v.id}>
              <div className="row">
                <strong>Created {fmtInstant(v.createdAt)}</strong>
                <span className={statusPillClass(v.status)}>{v.status}</span>
                <span className="muted">every {v.bookingIntervalMinutes} min</span>
              </div>
              {v.reason ? <p className="muted">{v.reason}</p> : null}
              <p className="muted schedule-summary">{describeVersion(v)}</p>
            </div>
          ))}
          {pages > 1 ? (
            <div className="row">
              <button
                type="button"
                className="secondary"
                disabled={page <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </button>
              <span className="muted">
                Page {page + 1} of {pages}
              </span>
              <button
                type="button"
                className="secondary"
                disabled={page + 1 >= pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function ScheduleSummary({ version }: { version: ScheduleVersionDto | null }) {
  if (!version) {
    return (
      <p className="muted">
        No schedule set — this business accepts bookings at any time (legacy all-day availability).
      </p>
    );
  }
  return (
    <div className="schedule-current">
      <h3>Current schedule</h3>
      <p className="muted">
        Saved {fmtInstant(version.createdAt)}
        {version.actorType === 'OWNER' && version.actorUserId ? ` by ${version.actorUserId}` : ''}.
      </p>
      <p className="muted schedule-summary">{describeVersion(version)}</p>
    </div>
  );
}

function describeVersion(version: ScheduleVersionDto): string {
  const days: string[] = [];
  for (let day = 0; day < 7; day += 1) {
    const windows = version.workingPeriods
      .filter((w) => w.dayOfWeek === day)
      .sort((a, b) => a.startMinutes - b.startMinutes);
    if (windows.length === 0) continue;
    const label = WEEKDAY_LABELS[day] ?? `Day ${day}`;
    const rendered = windows
      .map((w) => `${minutesToClock(w.startMinutes)}–${minutesToClock(w.endMinutes)}`)
      .join(', ');
    days.push(`${label} ${rendered}`);
  }
  const parts: string[] = [];
  if (days.length === 0) parts.push('no weekly windows');
  else parts.push(days.join(' · '));
  const specials = version.specialDates
    .map((s) =>
      s.isClosed
        ? `${s.calendarDate} closed`
        : `${s.calendarDate} ${s.periods
            .map((p) => `${minutesToClock(p.startMinutes)}–${minutesToClock(p.endMinutes)}`)
            .join(', ')}`,
    )
    .join(' · ');
  if (specials) parts.push(`special: ${specials}`);
  const blockedParts = version.blockedPeriods.map((b) => fmtInstant(b.startAt));
  if (blockedParts.length > 0) parts.push(`blocked: ${blockedParts.join(', ')}`);
  return parts.join(' · ');
}

function toLocalInput(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toISOString().slice(0, 16)}`;
}
