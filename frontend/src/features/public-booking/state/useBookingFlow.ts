import { useCallback, useRef, useState } from 'react'
import type {
  BusinessDetails,
  CustomerDetails,
  PaymentMethodId,
  ProofFile,
  ServiceSelection,
  SubmitResult,
} from '@/types/models'
import { createCustomerBooking } from '@/api/booking'
import { createdResultFromView } from '@/api/booking.mapper'
import { ApiError, toUserMessage } from '@/api/errors'

export const STEP_SERVICES = 0
export const STEP_DATE_TIME = 1
export const STEP_CUSTOMER = 2
export const STEP_REVIEW = 3
export const STEP_PAYMENT = 4
export const STEP_DONE = 5

export const BOOKING_STEP_LABELS = ['Services', 'Date & time', 'Your details', 'Review', 'Payment'] as const

const EMPTY_CUSTOMER: CustomerDetails = { name: '', phone: '', note: '' }

function newSubmissionKey(): string {
  const cryptoObj = globalThis.crypto
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID()
  }
  return `book-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Derives a safe, honest, actionable message for a failed booking submission.
 * The backend is authoritative and its field errors are never rendered raw; we
 * map the known booking fields to customer-facing copy and otherwise fall back
 * to the centralized `toUserMessage` (which never exposes internals).
 */
function submitFailureMessage(error: unknown): string {
  if (error instanceof ApiError && error.kind === 'validation' && error.fields) {
    const fields = error.fields
    if (fields.customerPhone) {
      return 'That phone number does not look valid. Please go back, check it and try again.'
    }
    if (fields.customerName) {
      return 'Please check the name on the booking and try again.'
    }
    if (fields.proof) {
      return 'Your payment proof was not accepted. Please attach a clear image or PDF and try again.'
    }
    if (fields.startAt || fields.selections) {
      return 'Your selected service or time is no longer valid. Please pick a service and time again.'
    }
    return 'Some details of your booking are not valid. Please go back and check them, then try again.'
  }
  return toUserMessage(error)
}

export function useBookingFlow(business: BusinessDetails) {
  const [step, setStep] = useState(STEP_SERVICES)
  const [selections, setSelections] = useState<ServiceSelection[]>([])
  const [date, setDateState] = useState<string | null>(null)
  const [time, setTime] = useState<string | null>(null)
  const [customer, setCustomer] = useState<CustomerDetails>(EMPTY_CUSTOMER)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodId | null>(null)
  const [proof, setProof] = useState<ProofFile | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<SubmitResult | null>(null)
  // Deposit due for the current selection, from the REAL availability view
  // (backend-computed, REQ-110/111). `0`/`null` means no payment proof is
  // required; the value drives whether the payment step appears and what the
  // customer must submit. Never derives from frontend state.
  const [depositMinor, setDepositMinor] = useState<number | null>(null)
  // Idempotency key (REQ-121): one stable key per wizard session so a double
  // submit (or a retry) is a no-op server-side, not a duplicated booking.
  // Regenerated only on reset() — never in a render effect.
  const submissionKeyRef = useRef<string | null>(null)

  const clearDateTime = useCallback(() => {
    setDateState(null)
    setTime(null)
  }, [])

  const toggleService = useCallback((serviceId: string) => {
    setSelections((current) => {
      const exists = current.some((s) => s.serviceId === serviceId)
      const next = exists
        ? current.filter((s) => s.serviceId !== serviceId)
        : [
            ...current,
            { serviceId, variationId: null, addOnIds: [] },
          ]
      return next
    })
    clearDateTime()
  }, [clearDateTime])

  const setVariation = useCallback(
    (serviceId: string, variationId: string | null) => {
      setSelections((current) =>
        current.map((s) =>
          s.serviceId === serviceId ? { ...s, variationId } : s,
        ),
      )
      clearDateTime()
    },
    [clearDateTime],
  )

  const toggleAddOn = useCallback((serviceId: string, addOnId: string) => {
    setSelections((current) =>
      current.map((s) => {
        if (s.serviceId !== serviceId) return s
        const has = s.addOnIds.includes(addOnId)
        return {
          ...s,
          addOnIds: has
            ? s.addOnIds.filter((id) => id !== addOnId)
            : [...s.addOnIds, addOnId],
        }
      }),
    )
    clearDateTime()
  }, [clearDateTime])

  const selectDate = useCallback((value: string) => {
    setDateState(value)
    setTime(null)
  }, [])

  const selectTime = useCallback((value: string | null) => setTime(value), [])

  const setCustomerField = useCallback(
    (field: keyof CustomerDetails, value: string) =>
      setCustomer((current) => ({ ...current, [field]: value })),
    [],
  )

  const replaceCustomer = useCallback((value: CustomerDetails) => {
    setCustomer({ ...EMPTY_CUSTOMER, ...value })
  }, [])

  const clearCustomer = useCallback(() => setCustomer(EMPTY_CUSTOMER), [])

  const setDate = useCallback((value: string | null) => setDateState(value), [])

  const setPayment = useCallback(
    (method: PaymentMethodId) => setPaymentMethod(method),
    [],
  )

  const setProofFile = useCallback((value: ProofFile | null) => setProof(value), [])

  const goTo = useCallback((nextStep: number) => {
    setStep((currentStep) =>
      nextStep >= STEP_SERVICES && nextStep <= STEP_DONE ? nextStep : currentStep,
    )
  }, [])

  const reset = useCallback(() => {
    submissionKeyRef.current = null
    setSelections([])
    clearDateTime()
    clearCustomer()
    setPaymentMethod(null)
    setProof(null)
    setResult(null)
    setDepositMinor(null)
    setSubmitting(false)
    setStep(STEP_SERVICES)
  }, [clearDateTime, clearCustomer])

  const submit = useCallback(async () => {
      if (date === null || time === null || customer.name.trim() === '' || customer.phone.trim() === '') {
        return
      }
      const requiresPayment = (depositMinor ?? 0) > 0
      if (requiresPayment && (paymentMethod === null || !proof?.file)) {
        return
      }
      const key = submissionKeyRef.current ?? newSubmissionKey()
      submissionKeyRef.current = key
      setSubmitting(true)
      setResult(null)
      try {
        const view = await createCustomerBooking(
          {
            businessSlug: business.slug,
            selections: selections.map((selection) => ({
              serviceId: selection.serviceId,
              variationId: selection.variationId ?? undefined,
              addOnIds:
                selection.addOnIds.length > 0 ? [...selection.addOnIds] : undefined,
            })),
            customerName: customer.name,
            customerPhone: customer.phone,
            note: customer.note.trim() ? customer.note.trim() : undefined,
            startAt: new Date(`${date}T${time}:00`).toISOString(),
            submissionKey: key,
            paymentMethod: requiresPayment
              ? paymentMethod === 'telebirr'
                ? 'TELEBIRR_MOBILE_MONEY'
                : 'BANK_TRANSFER'
              : undefined,
          },
          proof?.file ?? null,
        )
        setResult(createdResultFromView(view))
        setStep(STEP_DONE)
      } catch (error) {
        if (error instanceof ApiError && error.code === 'SLOT_UNAVAILABLE') {
          setResult({ status: 'unavailable' })
        } else {
          setResult({ status: 'error', message: submitFailureMessage(error) })
        }
        setStep(STEP_DONE)
      } finally {
        setSubmitting(false)
      }
    }, [selections, date, time, customer, paymentMethod, proof, depositMinor, business])

  return {
    step,
    selections,
    date,
    time,
    customer,
    paymentMethod,
    proof,
    submitting,
    result,
    // Deposit due (minor) disclosed by the real availability view; 0 when no
    // prepayment is configured. Null before the date/time step has resolved.
    depositMinor,
    toggleService,
    setVariation,
    toggleAddOn,
    selectDate,
    selectTime,
    setDate,
    setCustomerField,
    replaceCustomer,
    setPayment,
    setProofFile,
    setDepositMinor,
    goTo,
    reset,
    submit,
  }
}

export type BookingFlow = ReturnType<typeof useBookingFlow>