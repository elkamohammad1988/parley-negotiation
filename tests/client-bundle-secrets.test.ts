import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { dirname, join, relative, resolve } from 'path'

// No client component may reach the modules that hold the counterpart's
// secrets, by any chain of imports.
//
// lib/negotiation/redact.ts keeps the mandate out of every API response and
// every server-rendered prop. That is worthless if a 'use client' file imports
// lib/negotiation/scenarios.ts directly: the bundler then ships the whole
// SCENARIOS array, hiddenMandate and mandateLevers included, as a static JS
// chunk anyone can read in devtools before a rehearsal has even started. This
// was the state of /, /library and /onboarding until 2026-09-22.
//
// A client page that needs scenario content gets it as props from a server
// page, through a projection in redact.ts. This test walks the real import
// graph from every client entry point, so an indirect path (client file ->
// helper -> scenarios.ts) fails too.

const ROOT = resolve(__dirname, '..')
const SECRET_MODULES = ['lib/negotiation/scenarios.ts', 'lib/negotiation/prompt.ts'].map(p => join(ROOT, p))
const EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx']

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(name) ? [full] : []
  })
}

function isClientEntry(file: string): boolean {
  return /^\s*['"]use client['"]/.test(readFileSync(file, 'utf8'))
}

/** Value imports only. `import type` is erased and ships nothing. */
function localImports(file: string): string[] {
  const src = readFileSync(file, 'utf8')
  const specs = [...src.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map(m => m[1])
  const out: string[] = []
  for (const spec of specs) {
    let base: string | null = null
    if (spec.startsWith('@/')) base = join(ROOT, spec.slice(2))
    else if (spec.startsWith('.')) base = resolve(dirname(file), spec)
    if (!base) continue
    const hit = [base, ...EXTENSIONS.map(e => base + e)].find(p => existsSync(p) && statSync(p).isFile())
    if (hit) out.push(hit)
  }
  return out
}

function pathToSecret(entry: string): string[] | null {
  const seen = new Set<string>()
  const walk = (file: string, trail: string[]): string[] | null => {
    if (SECRET_MODULES.includes(file)) return trail
    if (seen.has(file)) return null
    seen.add(file)
    for (const next of localImports(file)) {
      const found = walk(next, [...trail, next])
      if (found) return found
    }
    return null
  }
  return walk(entry, [entry])
}

describe('client bundle secrets', () => {
  const entries = [...sourceFiles(join(ROOT, 'app')), ...sourceFiles(join(ROOT, 'lib'))].filter(isClientEntry)

  it('finds the client entry points it is meant to guard', () => {
    expect(entries.length).toBeGreaterThan(10)
  })

  it.each(entries.map(e => [relative(ROOT, e)]))('%s cannot import scenario secrets', rel => {
    const trail = pathToSecret(join(ROOT, rel))
    expect(trail?.map(p => relative(ROOT, p)).join(' -> ') ?? null).toBeNull()
  })
})
