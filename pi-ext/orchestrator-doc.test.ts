/**
 * Drift guard: the tool table in `docs/orchestration.md` must match
 * the tools this extension actually registers.
 *
 * That table is not decoration — it is what a reader (and an agent writing
 * orchestrator code) consults to learn how to call these tools. It drifted
 * badly and silently: an audit on 2026-08-30 found five of the ten rows had
 * the wrong arguments, including two tools documented as taking none that in
 * fact require one. Nothing failed, because a markdown table has no compile
 * step. `shared/rpc.ts` is the counter-example — its `_NoMissingResponseKeys`
 * guards are why the pi protocol mirror is the one integration surface that
 * did not drift. This test is the same idea for the orchestrator.
 *
 * The check is names only: every tool row present, and each row's argument
 * list equal to the schema's, with a trailing `?` meaning optional. Prose in
 * the "Does" column is deliberately unchecked.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ORCHESTRATOR_TOOLS } from './orchestrator'

/** `sessionId`, `limit?` → ['sessionId', 'limit?'] — order-insensitive later. */
function argsFromDocCell(cell: string): string[] {
  const trimmed = cell.trim()
  if (trimmed === '—') return []
  return [...trimmed.matchAll(/`([^`]+)`/g)].map((m) => (m[1] ?? '').trim())
}

function argsFromSchema(parameters: unknown): string[] {
  const schema = parameters as {
    properties?: Record<string, unknown>
    required?: string[]
  }
  const required = new Set(schema.required ?? [])
  return Object.keys(schema.properties ?? {}).map((k) => (required.has(k) ? k : `${k}?`))
}

/** The rows of the `| Tool | Args | Does |` table under the `### Tools` heading. */
function docToolRows(): Map<string, string[]> {
  const doc = readFileSync(join(__dirname, '..', 'docs', 'orchestration.md'), 'utf8')
  const start = doc.indexOf('\n### Tools\n')
  expect(start, 'orchestration.md must keep a `### Tools` section').toBeGreaterThan(-1)
  const section = doc.slice(start + 1).split('\n### ')[0] ?? ''
  const rows = new Map<string, string[]>()
  for (const line of section.split('\n')) {
    const m = /^\|\s*`([a-z_]+)`\s*\|([^|]*)\|/.exec(line)
    if (m) rows.set(m[1]!, argsFromDocCell(m[2]!))
  }
  return rows
}

describe('orchestration.md tool table', () => {
  const rows = docToolRows()

  it('documents every registered tool, and no tool that does not exist', () => {
    expect([...rows.keys()].sort()).toEqual(ORCHESTRATOR_TOOLS.map((t) => t.name).sort())
  })

  it.each(ORCHESTRATOR_TOOLS.map((t) => [t.name, t] as const))(
    '%s takes the arguments the doc says it does',
    (name, spec) => {
      expect(rows.get(name)?.sort()).toEqual(argsFromSchema(spec.parameters).sort())
    },
  )
})
