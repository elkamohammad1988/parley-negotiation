// The design system's public surface.
//
// Reach for these before writing a style object. The styling itself lives in
// the component layer of app/globals.css, and the numbers behind it live in
// lib/design.ts — a raw pixel value in a page is a signal that something is
// missing from one of those two files, not a licence to invent a new one.
//
// These components work in both registers. They read their colours from CSS
// variables, and .pl-room redefines those variables, so a button inside the
// live rehearsal is dark without anything being passed down to it.

export { default as Button } from './Button'
export type { ButtonProps } from './Button'

export { default as Card } from './Card'
export type { CardProps } from './Card'

export { Field, Input, Textarea, Select } from './Field'

export { default as Badge } from './Badge'
export type { BadgeTone } from './Badge'

export { Container, Section, Rule } from './Layout'
