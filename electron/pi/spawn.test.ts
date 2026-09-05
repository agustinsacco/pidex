import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { execFileAsync, type ExecFileFailure } from './spawn'

/** A node one-liner, so these run identically on macOS, Linux and Windows. */
function node(source: string): [string, string[]] {
  return [process.execPath, ['-e', source]]
}

describe('execFileAsync', () => {
  it('resolves stdout and stderr on a clean exit', async () => {
    const result = await execFileAsync(
      ...node('process.stdout.write("out"); process.stderr.write("err")'),
    )
    expect(result).toEqual({ stdout: 'out', stderr: 'err' })
  })

  it('rejects on a non-zero exit, keeping stdout, stderr and the code', async () => {
    const failed = await execFileAsync(
      ...node('process.stdout.write("partial"); process.stderr.write("boom"); process.exit(3)'),
    ).catch((error: ExecFileFailure) => error)

    const error = failed as ExecFileFailure
    // `claude auth status` prints its JSON and THEN exits non-zero when logged
    // out, so packages.ts reads stdout off the rejection — it must survive.
    expect(error.stdout).toBe('partial')
    expect(error.stderr).toBe('boom')
    expect(error.code).toBe(3)
    // health.ts falls back to `message` when stderr is empty; execFile put the
    // stderr in the message, so this keeps that reading useful.
    expect(error.message).toContain('boom')
  })

  it('rejects when the binary does not exist', async () => {
    const failed = await execFileAsync('pidex-no-such-binary-ever', ['--version']).catch(
      (error: ExecFileFailure) => error,
    )
    expect(failed).toBeInstanceOf(Error)
    expect((failed as ExecFileFailure).stdout).toBe('')
  })

  it('rejects on timeout instead of hanging', async () => {
    const started = Date.now()
    const failed = await execFileAsync(...node('setTimeout(() => {}, 60_000)'), {
      timeout: 250,
    }).catch((error: ExecFileFailure) => error)

    expect((failed as ExecFileFailure).message).toContain('timed out')
    expect(Date.now() - started).toBeLessThan(30_000)
  })

  it('ignores stdin rather than piping it', async () => {
    // `pi -p` blocks until stdin reaches EOF, and an open pipe is what hung
    // print-mode runs silently for weeks. An ignored stdin is /dev/null, so a
    // child that reads it to the end gets '' at once instead of waiting.
    const result = await execFileAsync(
      ...node('process.stdout.write(require("fs").readFileSync(0, "utf8") + "eof")'),
      { timeout: 10_000 },
    )
    expect(result.stdout).toBe('eof')
  })

  it('passes env through to the child', async () => {
    const result = await execFileAsync(...node('process.stdout.write(process.env.PIDEX_PROBE)'), {
      env: { ...process.env, PIDEX_PROBE: 'seen' },
    })
    expect(result.stdout).toBe('seen')
  })
})

describe('npm-shim call sites', () => {
  // pi, claude and npm are all installed by npm, so on Windows each is a
  // `.cmd` shim that node:child_process refuses to spawn. Every module that
  // launches one routes through ./spawn, and none of them launches anything
  // that needs child_process directly — so a reintroduced import here is the
  // regression, caught on macOS and Linux where it would otherwise pass.
  const shimCallers = [
    'rpc-client.ts',
    'print-mode.ts',
    'auth-status.ts',
    'claude-login.ts',
    'health.ts',
    'packages.ts',
  ]

  it.each(shimCallers)('%s spawns through ./spawn, not node:child_process', (file) => {
    const source = readFileSync(join(import.meta.dirname, file), 'utf8')
    expect(source).toMatch(/from '\.\/spawn'/)
    expect(source).not.toMatch(/from 'node:child_process'/)
  })
})
