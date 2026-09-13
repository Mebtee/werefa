import { useCallback, useState } from 'react'
import type {
  BookingDraft,
  BusinessDetails,
  CustomerDetails,
  PaymentMethodId,
  ProofFile,
  ServiceSelection,
  SubmitResult,
} from '@/types/models'
import { mockApi } from '@/mock/api'

export const STEP_SERVICES = 0
export const STEP_DATE_TIME = 1
export const STEP_CUSTOMER = 2
export const STEP_REVIEW = 3
export const STEP_PAYMENT = 4
export const STEP_DONE = 5

export const BOOKING_STEP_LABELS = ['Services', 'Date & time', 'Your details', 'Review', 'Payment'] as const

const EMPTY_CUSTOMER: CustomerDetails = { name: '', phone: '', note: '' }

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
    setSelections([])
    clearDateTime()
    clearCustomer()
    setPaymentMethod(null)
    setProof(null)
    setResult(null)
    setSubmitting(false)
    setStep(STEP_SERVICES)
  }, [clearDateTime, clearCustomer])

  const submit = useCallback(
    async (durationMinutes: number) => {
      const draft: BookingDraft = {
        selections,
        date,
        time,
        customer,
        paymentMethod: business.prepayment.mode === 'none' ? null : paymentMethod,
        proof: business.prepayment.mode === 'none' ? null : proof,
      }
      setSubmitting(true)
      setResult(null)
      try {
        const outcome = await mockApi.createBooking(draft, business, durationMinutes)
        setResult(outcome)
        setStep(STEP_DONE)
      } catch {
        setResult({ status: 'error' })
        setStep(STEP_DONE)
      } finally {
        setSubmitting(false)
      }
    },
    [selections, date, time, customer, paymentMethod, proof, business],
  )

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
    goTo,
    reset,
    submit,
  }
}

export type BookingFlow = ReturnType<typeof useBookingFlow>