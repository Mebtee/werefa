import { useState, useMemo, useEffect } from 'react'

interface CalendarDialogProps {
  isOpen: boolean
  onClose: () => void
  selectedDate: string | null
  onSelectDate: (date: string) => void
  availableDates?: readonly string[]
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export function CalendarDialog({
  isOpen,
  onClose,
  selectedDate,
  onSelectDate,
  availableDates = [],
}: CalendarDialogProps) {
  // Initialize view to selected date or today
  const initialDate = useMemo(() => {
    if (selectedDate && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
      const [y, m, d] = selectedDate.split('-').map(Number)
      return new Date(y, m - 1, d)
    }
    return new Date()
  }, [selectedDate])

  const [currentYear, setCurrentYear] = useState<number>(initialDate.getFullYear())
  const [currentMonth, setCurrentMonth] = useState<number>(initialDate.getMonth())
  const [tempSelectedDate, setTempSelectedDate] = useState<string | null>(selectedDate)

  // Keep internal state aligned when dialog opens or selectedDate changes
  useEffect(() => {
    if (isOpen) {
      setTempSelectedDate(selectedDate)
      if (selectedDate && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
        const [y, m] = selectedDate.split('-').map(Number)
        setCurrentYear(y)
        setCurrentMonth(m - 1)
      }
    }
  }, [isOpen, selectedDate])

  // Format header display date (e.g., "Oct 13, 2026")
  const headerDateDisplay = useMemo(() => {
    const active = tempSelectedDate || selectedDate
    if (active && /^\d{4}-\d{2}-\d{2}$/.test(active)) {
      const [y, m, d] = active.split('-').map(Number)
      const monthName = MONTH_SHORT[m - 1] ?? ''
      return `${monthName} ${d}, ${y}`
    }
    return 'Select Date'
  }, [tempSelectedDate, selectedDate])

  if (!isOpen) return null

  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11)
      setCurrentYear((y) => y - 1)
    } else {
      setCurrentMonth((m) => m - 1)
    }
  }

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0)
      setCurrentYear((y) => y + 1)
    } else {
      setCurrentMonth((m) => m + 1)
    }
  }

  // Days calculation
  const firstDayOfWeek = new Date(currentYear, currentMonth, 1).getDay()
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate()

  const handleConfirm = () => {
    if (tempSelectedDate) {
      onSelectDate(tempSelectedDate)
    }
    onClose()
  }

  return (
    <div className="cal-dialog-backdrop" onClick={onClose} role="presentation">
      <div
        className="cal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cal-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="cal-dialog__header">
          <div className="cal-dialog__subtitle" id="cal-dialog-title">
            Select Date
          </div>
          <div className="cal-dialog__title-row">
            <span className="cal-dialog__title">{headerDateDisplay}</span>
            <span className="cal-dialog__edit-icon" aria-hidden="true">✎</span>
          </div>
        </div>

        {/* Month Navigation */}
        <div className="cal-dialog__nav">
          <button type="button" className="cal-dialog__month-select" aria-label="Month and year">
            <span>{MONTH_NAMES[currentMonth]} {currentYear}</span>
            <span className="cal-dialog__chevron" aria-hidden="true">▾</span>
          </button>
          <div className="cal-dialog__nav-arrows">
            <button
              type="button"
              className="cal-dialog__arrow-btn"
              onClick={handlePrevMonth}
              aria-label="Previous month"
            >
              ‹
            </button>
            <button
              type="button"
              className="cal-dialog__arrow-btn"
              onClick={handleNextMonth}
              aria-label="Next month"
            >
              ›
            </button>
          </div>
        </div>

        {/* Weekday headers */}
        <div className="cal-dialog__weekdays">
          {WEEKDAYS.map((day, idx) => (
            <div key={`weekday-${idx}`} className="cal-dialog__weekday-cell">
              {day}
            </div>
          ))}
        </div>

        {/* Days Grid */}
        <div className="cal-dialog__grid">
          {Array.from({ length: firstDayOfWeek }).map((_, idx) => (
            <div key={`empty-${idx}`} className="cal-dialog__day-cell cal-dialog__day-cell--empty" />
          ))}

          {Array.from({ length: daysInMonth }).map((_, idx) => {
            const dayNum = idx + 1
            const mStr = String(currentMonth + 1).padStart(2, '0')
            const dStr = String(dayNum).padStart(2, '0')
            const iso = `${currentYear}-${mStr}-${dStr}`

            const isSelected = (tempSelectedDate || selectedDate) === iso
            const isAvailable = availableDates.length === 0 || availableDates.includes(iso)

            return (
              <button
                key={`day-${dayNum}`}
                type="button"
                className={`cal-dialog__day-cell ${
                  isSelected ? 'cal-dialog__day-cell--selected' : ''
                } ${!isAvailable ? 'cal-dialog__day-cell--disabled' : ''}`}
                onClick={() => {
                  if (isAvailable) {
                    setTempSelectedDate(iso)
                  }
                }}
                disabled={!isAvailable}
                aria-pressed={isSelected}
                aria-label={`Select date ${iso}`}
              >
                <span>{dayNum}</span>
              </button>
            )
          })}
        </div>

        {/* Dialog Actions */}
        <div className="cal-dialog__actions">
          <button type="button" className="cal-dialog__btn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="cal-dialog__btn-ok" onClick={handleConfirm}>
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
