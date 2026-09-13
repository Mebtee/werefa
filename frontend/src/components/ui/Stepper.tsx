import { cn } from '@/lib/cn'

interface StepperProps {
  steps: readonly string[]
  current: number
}

export function Stepper({ steps, current }: StepperProps) {
  return (
    <nav aria-label="Booking progress" className="stepper">
      <ol
        className="stepper__list"
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'contents',
        }}
      >
        {steps.map((step, index) => {
          const state =
            index === current ? 'current' : index < current ? 'done' : 'todo'
          const isLast = index === steps.length - 1
          return (
            <li
              key={step}
              className={cn(
                'stepper__step',
                state === 'done' && 'stepper__step--done',
              )}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <span className="stepper__dot" aria-hidden="true">
                {state === 'done' ? '✓' : index + 1}
              </span>
              <span>
                <span className="sr-only">
                  {state === 'current' ? 'Current step: ' : ''}
                </span>
                {step}
              </span>
              {!isLast && <span className="stepper__divider" aria-hidden="true" />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}