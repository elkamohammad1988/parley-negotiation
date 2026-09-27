'use client'
import { createContext, useContext, useId } from 'react'
import type { ComponentProps, ReactNode } from 'react'

// Label, hint, control, error — wired together rather than merely stacked.
//
// The wiring is the reason this exists. Every form in the product had a <label>
// sitting above an <input> with nothing joining them, so clicking the label did
// not focus the field and a screen reader read the control as unlabelled. Doing
// that correctly means generating an id and threading it plus aria-describedby
// through to the control, which is exactly the kind of work that gets skipped
// when each form writes its own.
//
// Field passes the ids down through context so the call site stays flat:
//
//   <Field label="What is at stake?" hint="One sentence." error={errors.stake}>
//     <Textarea value={stake} onChange={e => setStake(e.target.value)} />
//   </Field>

type FieldContextValue = {
  id: string
  describedBy?: string
  invalid: boolean
}

const FieldContext = createContext<FieldContextValue | null>(null)

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string
  hint?: string
  error?: string | null
  children: ReactNode
  className?: string
}) {
  const base = useId()
  const id = `${base}-control`
  const hintId = hint ? `${base}-hint` : undefined
  const errorId = error ? `${base}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: !!error }}>
      <div className={className} style={{ marginBottom: 24 }}>
        <label htmlFor={id} className="pl-label">
          {label}
        </label>
        {hint && (
          <p id={hintId} className="pl-hint">
            {hint}
          </p>
        )}
        {children}
        {error && (
          // role="alert" so the message is announced when it appears after a
          // failed submit, not only when the field is next focused.
          <p id={errorId} role="alert" className="pl-field-error">
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  )
}

/** Controls fall back to their own props when used outside a <Field>. */
function useFieldProps(className: string, own: { id?: string; className?: string }) {
  const ctx = useContext(FieldContext)
  return {
    id: own.id ?? ctx?.id,
    'aria-describedby': ctx?.describedBy,
    'aria-invalid': ctx?.invalid || undefined,
    className: [className, own.className].filter(Boolean).join(' '),
  }
}

export function Input(props: ComponentProps<'input'>) {
  const wired = useFieldProps('pl-input', props)
  return <input {...props} {...wired} />
}

export function Textarea(props: ComponentProps<'textarea'>) {
  const wired = useFieldProps('pl-textarea', props)
  return <textarea {...props} {...wired} />
}

export function Select(props: ComponentProps<'select'>) {
  const wired = useFieldProps('pl-select', props)
  return <select {...props} {...wired} />
}

export default Field
