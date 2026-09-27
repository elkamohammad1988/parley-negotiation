import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// The deployment-wide token ceiling. Per-user limits are keyed on an id a guest
// mints for itself, so they cannot bound what a public demo spends in a day.
// This is the guard that does, and these tests run the real module against an
// in-memory usage_daily table.

type Row = { user_id: string; usage_date: string; tokens_used: number; bonus_tokens: number }
const table: Row[] = []

function builder() {
  const filters: Record<string, unknown> = {}
  let op: 'select' | 'insert' | 'update' = 'select'
  let payload: Partial<Row> = {}
  const matches = () => table.filter(r => Object.entries(filters).every(([k, v]) => r[k as keyof Row] === v))
  const q = {
    select: () => q,
    eq: (k: string, v: unknown) => {
      filters[k] = v
      if (op === 'update') for (const r of matches()) Object.assign(r, payload)
      return q
    },
    order: () => q,
    limit: () => q,
    insert: (row: Row) => {
      op = 'insert'
      table.push({ ...row })
      payload = row
      return q
    },
    update: (patch: Partial<Row>) => {
      op = 'update'
      payload = patch
      return q
    },
    maybeSingle: async () => {
      if (op === 'insert') return { data: { ...payload }, error: null }
      return { data: matches()[0] ?? null, error: null }
    },
    then: (resolve: (v: unknown) => void) => resolve({ error: null }),
  }
  return q
}

// add_token_usage() as the SQL defines it: create the day's row or add to it.
// `rpcFails` stands in for a database migrated before 009a.
let rpcFails = false
async function rpc(fn: string, args: { p_user_id: string; p_usage_date: string; p_tokens: number }) {
  if (fn !== 'add_token_usage' || rpcFails) return { data: null, error: { message: 'function does not exist' } }
  let row = table.find(r => r.user_id === args.p_user_id && r.usage_date === args.p_usage_date)
  if (!row) {
    row = { user_id: args.p_user_id, usage_date: args.p_usage_date, tokens_used: 0, bonus_tokens: 0 }
    table.push(row)
  }
  row.tokens_used += Math.max(args.p_tokens, 0)
  return { data: row.tokens_used, error: null }
}

vi.mock('@/lib/supabase-server', () => ({ supabaseServer: { from: () => builder(), rpc } }))

const {
  isOverGlobalBudget,
  recordTokenUsage,
  globalDailyTokenBudget,
  GLOBAL_USAGE_ID,
  DEFAULT_GLOBAL_DAILY_TOKEN_BUDGET,
} = await import('@/lib/usageLimits')

const today = () => new Date().toISOString().slice(0, 10)
const globalRow = () => table.find(r => r.user_id === GLOBAL_USAGE_ID && r.usage_date === today())

describe('global daily token budget', () => {
  beforeEach(() => {
    table.length = 0
    rpcFails = false
    delete process.env.GLOBAL_DAILY_TOKEN_BUDGET
  })

  it('defaults when unset or malformed, and accepts -1 as disabled', () => {
    expect(globalDailyTokenBudget()).toBe(DEFAULT_GLOBAL_DAILY_TOKEN_BUDGET)
    process.env.GLOBAL_DAILY_TOKEN_BUDGET = 'lots'
    expect(globalDailyTokenBudget()).toBe(DEFAULT_GLOBAL_DAILY_TOKEN_BUDGET)
    process.env.GLOBAL_DAILY_TOKEN_BUDGET = '-1'
    expect(globalDailyTokenBudget()).toBe(-1)
  })

  it('sums usage across different users, including fresh guest ids', async () => {
    process.env.GLOBAL_DAILY_TOKEN_BUDGET = '1000'
    await recordTokenUsage('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'free', 400)
    await recordTokenUsage('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'free', 400)
    expect(globalRow()?.tokens_used).toBe(800)
    expect(await isOverGlobalBudget()).toBe(false)

    await recordTokenUsage('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'free', 200)
    expect(await isOverGlobalBudget()).toBe(true)
  })

  it('never blocks when disabled', async () => {
    process.env.GLOBAL_DAILY_TOKEN_BUDGET = '-1'
    await recordTokenUsage('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'free', 10_000_000)
    expect(await isOverGlobalBudget()).toBe(false)
  })

  it('still records the per-user row alongside the global one', async () => {
    await recordTokenUsage('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'free', 300)
    expect(table.find(r => r.user_id.startsWith('aaaa'))?.tokens_used).toBe(300)
    expect(globalRow()?.tokens_used).toBe(300)
  })

  it('does not lose increments when many turns record at once', async () => {
    // Twenty concurrent recorders. With read-then-write they all read 0 and
    // the row ends at 100; the atomic upsert must end at 2000.
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        recordTokenUsage(`aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`, 'free', 100)
      )
    )
    expect(globalRow()?.tokens_used).toBe(2000)
  })

  it('still records through the old path when the RPC is unavailable', async () => {
    rpcFails = true
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await recordTokenUsage('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'free', 250)
    expect(globalRow()?.tokens_used).toBe(250)
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
})

describe('add_token_usage() in the schema', () => {
  const SQL = readFileSync(join(process.cwd(), 'supabase_migrations.sql'), 'utf8')
  const fn = SQL.match(/create or replace function public\.add_token_usage[\s\S]*?\$\$;/)?.[0] ?? ''

  it('adds in the same statement it reads, so concurrent calls cannot overwrite each other', () => {
    expect(fn).toMatch(/on conflict \(user_id, usage_date\)/)
    expect(fn).toMatch(/tokens_used = u\.tokens_used \+ excluded\.tokens_used/)
  })

  it('is callable by the server only', () => {
    expect(SQL).toMatch(/grant execute on function public\.add_token_usage\(uuid, date, bigint\) to service_role;/)
    expect(SQL).toMatch(/revoke execute on function public\.add_token_usage\(uuid, date, bigint\) from public, anon, authenticated;/)
  })
})
