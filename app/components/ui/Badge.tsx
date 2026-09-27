import type { ComponentProps, ReactNode } from 'react'

// A small status mark. Difficulty, category, plan tier, rehearsal state.
//
// The tones are the product's colour language, not a palette: clay is the
// user's side and pressure, steel is the counterpart's. A badge describing
// something the counterpart did takes `steel`; it never takes `clay`.

export type BadgeTone = 'neutral' | 'clay' | 'steel' | 'gain' | 'warn'

export default function Badge({
  tone = 'neutral',
  className,
  children,
  ...rest
}: { tone?: BadgeTone; children: ReactNode } & Omit<ComponentProps<'span'>, 'children'>) {
  return (
    <span {...rest} className={['pl-badge', `pl-badge--${tone}`, className].filter(Boolean).join(' ')}>
      {children}
    </span>
  )
}
