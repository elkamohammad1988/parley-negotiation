import type { ComponentProps, ElementType, ReactNode } from 'react'

// Page scaffolding.
//
// This exists because the app had ten different container widths — 1160, 1000,
// 720, 680, 620, 560, 520, 420, 400, 360 — each one chosen locally and none of
// them wrong on its own. Together they mean no two pages line up. Four widths
// cover every surface in the product:
//
//   page     the default. Marketing, dashboards, anything with a grid.
//   narrow   a single column of cards or settings rows.
//   reading  long-form prose: briefs, debriefs, playbook entries, legal.
//   form     sign-up, sign-in, password reset.
//
// Section owns the vertical rhythm for the same reason. A landing page whose
// every section is `padding: 64px 24px 0` reads as generated, because the eye
// gets no signal about which section matters more than the next.

type Width = 'page' | 'narrow' | 'reading' | 'form'

const WIDTH_CLASS: Record<Width, string> = {
  page: '',
  narrow: 'pl-container--narrow',
  reading: 'pl-container--reading',
  form: 'pl-container--form',
}

export function Container({
  width = 'page',
  className,
  children,
  ...rest
}: { width?: Width; children: ReactNode } & Omit<ComponentProps<'div'>, 'children'>) {
  return (
    <div
      {...rest}
      className={['pl-container', WIDTH_CLASS[width], className].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  )
}

type Space = 'tight' | 'normal' | 'loose'

const SPACE_CLASS: Record<Space, string> = {
  tight: 'pl-section--tight',
  normal: '',
  loose: 'pl-section--lg',
}

export function Section({
  space = 'normal',
  width = 'page',
  as: Tag = 'section',
  className,
  children,
  ...rest
}: {
  space?: Space
  width?: Width
  as?: ElementType
  children: ReactNode
} & Omit<ComponentProps<'section'>, 'children'>) {
  return (
    <Tag {...rest} className={['pl-section', SPACE_CLASS[space], className].filter(Boolean).join(' ')}>
      <Container width={width}>{children}</Container>
    </Tag>
  )
}

/** A hairline between sections. Border colour and nothing else. */
export function Rule({ className, ...rest }: ComponentProps<'hr'>) {
  return <hr {...rest} className={['pl-rule', className].filter(Boolean).join(' ')} />
}
