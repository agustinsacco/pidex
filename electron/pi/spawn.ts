/**
 * Subprocess launchers for the tools pidex shells out to — `pi`, `claude`,
 * `npm`, and the e2e stub.
 *
 * All four are installed by npm, and on Windows npm installs a binary as a
 * `.cmd` shim rather than an executable. Node's `child_process.spawn` refuses
 * to run a `.cmd` without a shell (`EINVAL`, from the CVE-2024-27980
 * hardening), so a raw `spawn('pi', …)` cannot start a session on Windows at
 * all — the failure is at the very first RPC spawn, before any UI exists to
 * report it.
 *
 * `cross-spawn` is the fix, and it is the same one pi and `pi-claude-cli`
 * already use — both depend on it, so this only brings pidex up to what it
 * spawns. It resolves the shim, reads its shebang, and re-invokes through
 * `cmd.exe /d /s /c` with `windowsVerbatimArguments` and per-argument
 * escaping.
 *
 * **Used unconditionally, not behind a `win32` branch.** `parseNonShell()`
 * returns its input untouched when `process.platform !== 'win32'` (verified
 * against cross-spawn 7.0.6), so on macOS and Linux this is a literal
 * passthrough to `child_process.spawn` — no PATH lookup, no shebang read, no
 * behaviour change. A platform branch here would instead mean the Windows
 * path is the one nothing ever exercises.
 *
 * Callers that spawn a REAL executable (`git`, `gh`, `where`, `/bin/sh`,
 * node-pty's shell) do not need this and still import `node:child_process`
 * directly.
 */
import type { ChildProcess, ChildProcessWithoutNullStreams } from 'node:child_process'
import crossSpawn from 'cross-spawn'

/** Drop-in for `child_process.spawn` that also runs npm shims on Windows. */
export const spawn = crossSpawn

/**
 * Re-exported so a shim caller has no reason to import `node:child_process`
 * at all — importing it for a type, then reaching for its `spawn` later, is
 * exactly the regression `spawn.test.ts` guards against.
 */
export type { ChildProcess, ChildProcessWithoutNullStreams }

/**
 * `spawn` for callers that pipe all three streams and then read them without
 * null checks — the RPC client touches `child.stdout` on every message.
 * cross-spawn is typed to return the general `ChildProcess`, whose streams are
 * nullable; `stdio: ['pipe', 'pipe', 'pipe']` is what makes all three present,
 * so pinning the two together here keeps that invariant in one place.
 */
export function spawnPiped(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): ChildProcessWithoutNullStreams {
  return spawn(command, args, {
    ...options,
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams
}

/** Cap on retained output, matching the other subprocess readers here. */
const MAX_BUFFER_BYTES = 10 * 1024 * 1024

export interface ExecFileOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** Milliseconds before the child is SIGKILLed and the call rejects. */
  timeout?: number
  maxBuffer?: number
}

export interface ExecFileResult {
  stdout: string
  stderr: string
}

/**
 * What a rejection carries. Call sites read all three: `health.ts` prefers
 * `stderr` over `message`, and `packages.ts` parses `stdout` off a NON-zero
 * exit, because `claude auth status` prints its JSON and then exits 1 when
 * logged out.
 */
export interface ExecFileFailure extends Error {
  code?: number | string
  stdout: string
  stderr: string
}

/**
 * `promisify(execFile)` equivalent, over `spawn` above.
 *
 * The contract kept from `execFile`: resolve `{stdout, stderr}` on exit 0,
 * reject otherwise with `stdout`/`stderr`/`code` attached and a
 * `Command failed: …` message that carries stderr. The one deliberate
 * difference is that a timeout sends SIGKILL rather than `execFile`'s
 * SIGTERM — these are short version/auth probes with nothing to flush, and
 * a shim wrapped in `cmd.exe` can outlive a SIGTERM aimed at the wrapper.
 */
export function execFileAsync(
  file: string,
  args: string[],
  options: ExecFileOptions = {},
): Promise<ExecFileResult> {
  const maxBuffer = options.maxBuffer ?? MAX_BUFFER_BYTES
  return new Promise<ExecFileResult>((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false

    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env,
      // stdin is ignored, never piped: `pi -p` blocks until stdin reaches EOF,
      // and an open pipe is what silently hung print-mode runs for weeks.
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const settle = (action: () => void): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      action()
    }

    const timer = options.timeout
      ? setTimeout(() => {
          child.kill('SIGKILL')
          settle(() => reject(failure(`timed out after ${options.timeout}ms`, stdout, stderr)))
        }, options.timeout)
      : undefined

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < maxBuffer) stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < maxBuffer) stderr += chunk.toString()
    })

    // cross-spawn re-emits a shim's ENOENT here rather than throwing.
    child.on('error', (error) => {
      settle(() => reject(failure(error.message, stdout, stderr)))
    })

    child.on('close', (code) => {
      settle(() => {
        if (code === 0) {
          resolve({ stdout, stderr })
          return
        }
        const message = `Command failed: ${file} ${args.join(' ')}${stderr ? `\n${stderr}` : ''}`
        reject(failure(message, stdout, stderr, code))
      })
    })
  })
}

function failure(
  message: string,
  stdout: string,
  stderr: string,
  code?: number | null,
): ExecFileFailure {
  const error = new Error(message) as ExecFileFailure
  error.stdout = stdout
  error.stderr = stderr
  if (code !== null && code !== undefined) error.code = code
  return error
}
