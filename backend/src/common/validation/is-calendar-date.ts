import { registerDecorator, ValidationOptions, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator'

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * Rejects date keys that match the 'YYYY-MM-DD' surface shape but are not a
 * real calendar day (e.g. '2026-02-30', '2026-13-01'). Without this check the
 * availability engine would silently normalize an impossible date via
 * Date.UTC and answer the wrong day.
 */
export function isCalendarDateKey(value: unknown): boolean {
  if (typeof value !== 'string' || !DATE_KEY_PATTERN.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const probe = new Date(Date.UTC(year, month - 1, day))
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  )
}

@ValidatorConstraint({ name: 'isCalendarDateKey', async: false })
class IsCalendarDateKeyConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isCalendarDateKey(value)
  }

  defaultMessage(): string {
    return 'Date must be a real calendar day in YYYY-MM-DD format.'
  }
}

export function IsCalendarDateKey(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsCalendarDateKeyConstraint,
    })
  }
}