import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPrintMode } from './print-mode'

/**
 * The fixture behaves like `pi -p`: it does not answer until stdin reaches
 * EOF. That is the exact behaviour that made `execFile` hang forever and left
 * every session unnamed, and it is why the e2e stub could not catch it — the
 * stub prints and exits without ever looking at stdin.
 */
let dir: string
let blockingScript: string
let failingScript: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pidex-print-mode-'))
  blockingScript = join(dir, 'waits-for-stdin.cjs')
  writeFileSync(
    blockingScript,
    [
      'const chunks = []',
      "process.stdin.on('data', (c) => chunks.push(c))",
      "process.stdin.on('end', () => {",
      "  process.stdout.write('Friendly Greeting\\n')",
      '  process.exit(0)',
      '})',
    ].join('\n'),
  )
  failingScript = join(dir, 'fails.cjs')
  writeFileSync(failingScript, ["process.stderr.write('nope\\n')", 'process.exit(3)'].join('\n'))
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

const run = (script: string, timeoutMs = 5_000): ReturnType<typeof runPrintMode> =>
  runPrintMode(process.execPath, [script], { cwd: dir, env: process.env, timeoutMs })

describe('runPrintMode', () => {
  it('completes a command that waits for stdin EOF', async () => {
    const result = await run(blockingScript)
    expect(result.error).toBeUndefined()
    expect(result.stdout.trim()).toBe('Friendly Greeting')
  })

  it('reports a non-zero exit with its stderr rather than throwing', async () => {
    const result = await run(failingScript)
    expect(result.stdout).toBe('')
    expect(result.error).toContain('exited 3')
    expect(result.error).toContain('nope')
  })

  it('reports a spawn failure rather than throwing', async () => {
    const result = await runPrintMode(join(dir, 'does-not-exist'), [], {
      cwd: dir,
      env: process.env,
      timeoutMs: 5_000,
    })
    expect(result.stdout).toBe('')
    expect(result.error).toBeTruthy()
  })
})
