import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'

// The product's one button.
//
// Styling lives in .pl-btn in globals.css, not here, because hover, active,
// disabled and focus-visible are pseudo-classes and a style object cannot
// express them. This component's only job is to pick the variant and decide
// whether the thing is a <button> or a link.
//
// `href` is what makes it a link. Roughly half the buttons in this product are
// navigation — "Start a rehearsal", "Read the debrief" — and writing those as
// a styled <Link> by hand is how they drifted apart in the first place.

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

type CommonProps = {
  variant?: Variant
  size?: Size
  /** Fills the width of its container. For form submits and mobile layouts. */
  block?: boolean
  className?: string
  children: ReactNode
}

type ButtonAsButton = CommonProps &
  Omit<ComponentProps<'button'>, keyof CommonProps | 'href'> & { href?: undefined }

type ButtonAsLink = CommonProps &
  Omit<ComponentProps<typeof Link>, keyof CommonProps> & { href: string }

export type ButtonProps = ButtonAsButton | ButtonAsLink

export default function Button(props: ButtonProps) {
  const { variant = 'primary', size = 'md', block = false, className, children, ...rest } = props

  const cls = [
    'pl-btn',
    `pl-btn--${variant}`,
    size !== 'md' && `pl-btn--${size}`,
    block && 'pl-btn--block',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  if (rest.href !== undefined) {
    return (
      <Link {...(rest as ComponentProps<typeof Link>)} className={cls}>
        {children}
      </Link>
    )
  }

  const buttonProps = rest as ComponentProps<'button'>
  return (
    <button {...buttonProps} type={buttonProps.type ?? 'button'} className={cls}>
      {children}
    </button>
  )
}
