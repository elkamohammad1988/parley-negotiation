import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'

// A surface. Three variants and nothing else:
//
//   default     — a panel that sits still.
//   interactive — a card that is itself a link. It lifts a pixel under the
//                 cursor. Passing `href` turns this on; there is deliberately
//                 no way to get the hover without the navigation, because a
//                 card that reacts to the cursor and then does nothing when
//                 clicked is worse than one that never moved.
//   sunken      — recessed rather than raised. For asides, empty states and
//                 anything quoting content from somewhere else.
//
// Padding is a prop rather than baked in: a card holding a paragraph and a card
// holding a table do not want the same inset, and the alternative is every
// caller reaching past the component with a style override.

type Pad = 'none' | 'sm' | 'md' | 'lg'

const PAD: Record<Pad, number | undefined> = {
  none: undefined,
  sm: 14,
  md: 20,
  lg: 28,
}

type CommonProps = {
  pad?: Pad
  sunken?: boolean
  className?: string
  children: ReactNode
}

type CardAsDiv = CommonProps &
  Omit<ComponentProps<'div'>, keyof CommonProps | 'href'> & { href?: undefined }

type CardAsLink = CommonProps &
  Omit<ComponentProps<typeof Link>, keyof CommonProps> & { href: string }

export type CardProps = CardAsDiv | CardAsLink

export default function Card(props: CardProps) {
  const { pad = 'md', sunken = false, className, children, ...rest } = props

  const cls = [
    'pl-card',
    rest.href !== undefined && 'pl-card--interactive',
    sunken && 'pl-card--sunken',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  // Callers can still override padding through `style`; the token is the
  // default, not a wall.
  const style = { padding: PAD[pad], ...rest.style }

  if (rest.href !== undefined) {
    return (
      <Link {...(rest as ComponentProps<typeof Link>)} className={cls} style={style}>
        {children}
      </Link>
    )
  }

  return (
    <div {...(rest as ComponentProps<'div'>)} className={cls} style={style}>
      {children}
    </div>
  )
}
